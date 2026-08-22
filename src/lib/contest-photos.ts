import type { SupabaseClient } from "@supabase/supabase-js";

export const CONTEST_PHOTOS_BUCKET = "contest-photos";
/** Soft limit after client compression — storage / action payloads stay bounded. */
export const MAX_CONTEST_PHOTO_BYTES = 5 * 1024 * 1024;
/**
 * Hard ceiling on the original pick before we try to compress in the browser
 * (avoids OOM on multi‑tens‑of‑MB camera dumps).
 */
export const MAX_SOURCE_PHOTO_BYTES = 40 * 1024 * 1024;
/** Soft budget for all photo files in one create Server Action (after compression). */
export const CREATE_PHOTO_BODY_BUDGET_BYTES = 48 * 1024 * 1024;

export const PHOTO_TOO_LARGE_MESSAGE =
  "This photo is still over 5 MB after compression. Please try a different image.";
export const PHOTO_SOURCE_TOO_LARGE_MESSAGE =
  "This photo is too large to process in the browser (over 40 MB). Please choose a smaller original.";
export const PHOTO_COMPRESS_FAILED_MESSAGE =
  "Could not compress this photo. Please try another image.";
export const PHOTOS_TOO_MANY_OR_LARGE_MESSAGE =
  "These photos are too large or there are too many to create the contest in one go. Please upload fewer photos, then try again.";

export const ALLOWED_CONTEST_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

type AllowedMime = (typeof ALLOWED_CONTEST_PHOTO_TYPES)[number];

function extensionForMime(mime: AllowedMime): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/** Type + non-empty check for a picked source file (size may still be > 5 MB). */
export function validateContestPhotoSource(
  file: File,
): { ok: true; mime: AllowedMime } | { ok: false; error: string } {
  if (!ALLOWED_CONTEST_PHOTO_TYPES.includes(file.type as AllowedMime)) {
    return {
      ok: false,
      error: "Please choose a JPEG, PNG, or WebP image.",
    };
  }
  if (file.size <= 0) {
    return { ok: false, error: "Please choose a photo." };
  }
  if (file.size > MAX_SOURCE_PHOTO_BYTES) {
    return { ok: false, error: PHOTO_SOURCE_TOO_LARGE_MESSAGE };
  }
  return { ok: true, mime: file.type as AllowedMime };
}

/** Final file ready for upload / Server Action (must be ≤ 5 MB). */
export function validateContestPhotoFile(
  file: File,
): { ok: true; mime: AllowedMime } | { ok: false; error: string } {
  const source = validateContestPhotoSource(file);
  if (!source.ok) return source;
  if (file.size > MAX_CONTEST_PHOTO_BYTES) {
    return { ok: false, error: PHOTO_TOO_LARGE_MESSAGE };
  }
  return { ok: true, mime: file.type as AllowedMime };
}

async function encodeJpegBlob(
  bitmap: ImageBitmap,
  maxEdge: number,
  quality: number,
): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });
}

/**
 * Browser-only: shrink phone photos so each file is under 5 MB before upload.
 * Large originals are allowed; we compress automatically instead of rejecting them.
 */
export async function prepareContestPhotoForUpload(
  file: File,
): Promise<File | { error: string }> {
  const source = validateContestPhotoSource(file);
  if (!source.ok) return { error: source.error };

  // Already within the upload budget — keep original format when possible.
  if (file.size <= MAX_CONTEST_PHOTO_BYTES) {
    return file;
  }

  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return { error: PHOTO_COMPRESS_FAILED_MESSAGE };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { error: PHOTO_COMPRESS_FAILED_MESSAGE };
  }

  const base = file.name.replace(/\.[^.]+$/, "").trim() || "photo";
  const edgeSteps = [2560, 2048, 1600, 1280, 1024, 800, 640];
  const qualitySteps = [0.88, 0.8, 0.72, 0.64, 0.55, 0.45];

  try {
    for (const maxEdge of edgeSteps) {
      for (const quality of qualitySteps) {
        const blob = await encodeJpegBlob(bitmap, maxEdge, quality);
        if (!blob || blob.size <= 0) continue;
        if (blob.size <= MAX_CONTEST_PHOTO_BYTES) {
          bitmap.close();
          return new File([blob], `${base}.jpg`, {
            type: "image/jpeg",
            lastModified: Date.now(),
          });
        }
      }
    }
  } catch {
    bitmap.close();
    return { error: PHOTO_COMPRESS_FAILED_MESSAGE };
  }

  bitmap.close();
  return { error: PHOTO_TOO_LARGE_MESSAGE };
}

/** Upload a contest photo; path = {contestId}/{userId}/{uuid}.ext */
export async function uploadContestPhoto(
  supabase: SupabaseClient,
  contestId: string,
  file: File,
): Promise<{ url: string } | { error: string }> {
  const validated = validateContestPhotoFile(file);
  if (!validated.ok) return { error: validated.error };

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: "Please sign in again, then try uploading." };
  }

  const ext = extensionForMime(validated.mime);
  const objectId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${contestId}/${user.id}/${objectId}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(CONTEST_PHOTOS_BUCKET)
    .upload(path, file, {
      contentType: validated.mime,
      upsert: false,
      cacheControl: "3600",
    });

  if (uploadError) {
    return { error: uploadError.message || "Photo upload failed." };
  }

  const { data } = supabase.storage
    .from(CONTEST_PHOTOS_BUCKET)
    .getPublicUrl(path);

  if (!data?.publicUrl) {
    return { error: "Photo uploaded but public URL is missing." };
  }

  return { url: data.publicUrl };
}

/** Extract storage object path from a public contest-photos URL. */
export function storagePathFromPublicUrl(publicUrl: string): string | null {
  const marker = `/object/public/${CONTEST_PHOTOS_BUCKET}/`;
  const index = publicUrl.indexOf(marker);
  if (index === -1) return null;
  const path = decodeURIComponent(
    publicUrl.slice(index + marker.length).split("?")[0] ?? "",
  );
  return path.length > 0 ? path : null;
}

const IMAGE_PATH_EXT = /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i;
const IMAGE_URL_EXT = /\.(jpe?g|png|webp|gif|avif|heic|heif)(\?|#|$)/i;

/**
 * True when a candidate URL should render as an expandable photo thumbnail
 * (Anything attachments uploaded to contest-photos, or common image URLs / blob previews).
 */
export function isContestImageUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  const trimmed = url.trim();
  if (trimmed.startsWith("blob:")) return true;
  if (trimmed.startsWith("data:image/")) return true;
  // Public, signed, and render URLs for the contest-photos bucket.
  const bucketMarker = CONTEST_PHOTOS_BUCKET.toLowerCase();
  const lower = trimmed.toLowerCase();
  if (
    lower.includes(bucketMarker) &&
    (lower.includes("/object/") ||
      lower.includes("/render/") ||
      lower.includes("/storage/"))
  ) {
    return true;
  }
  try {
    const path = new URL(trimmed).pathname;
    return IMAGE_PATH_EXT.test(path);
  } catch {
    return IMAGE_URL_EXT.test(trimmed);
  }
}

/**
 * After presentation finishes (results_phase = done), remove Storage objects
 * for candidates that opted into delete-on-finish (URLs already cleared in DB
 * and stashed in meta.storage_delete_url).
 */
export async function flushPendingContestPhotoDeletes(
  supabase: SupabaseClient,
  contestId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("candidates")
    .select("id, meta")
    .eq("contest_id", contestId)
    .eq("delete_photo_on_finish", true);

  if (error || !data?.length) return;

  const pending: Array<{ id: string; url: string }> = [];
  for (const row of data) {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const url =
      typeof meta.storage_delete_url === "string" ? meta.storage_delete_url : null;
    if (url) pending.push({ id: row.id as string, url });
  }
  if (pending.length === 0) return;

  const paths = pending
    .map((item) => storagePathFromPublicUrl(item.url))
    .filter((path): path is string => Boolean(path));

  if (paths.length > 0) {
    await supabase.storage.from(CONTEST_PHOTOS_BUCKET).remove(paths);
  }

  await supabase.rpc("ack_contest_photo_storage_deleted", {
    p_contest_id: contestId,
    p_candidate_ids: pending.map((item) => item.id),
  });
}
