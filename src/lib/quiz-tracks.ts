import { findSpotifyTrack, getSpotifyTrackById } from "@/lib/spotify";
import { lookupItunesTrackMeta } from "@/lib/music";
import { DEFAULT_MAX_CURATED_TRACKS } from "@/lib/quiz-plans";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export type QuizTrackInput = {
  title: string;
  artist: string;
  previewUrl?: string;
  spotifyTrackId?: string;
  albumArtUrl?: string;
  releaseYear?: number | null;
};

export type ResolvedQuizTrack = {
  trackName: string;
  artistName: string | null;
  spotifyTrackId: string | null;
  albumArtUrl: string | null;
  previewUrl: string | null;
  releaseYear: number | null;
  originalReleaseYear: number | null;
};

/** Effective curated-track cap for a quiz (null = unlimited). */
export async function getQuizCuratedTrackLimit(
  quizId: string,
): Promise<number | null> {
  const admin = createAdminClient();
  const { data: quiz, error } = await admin
    .from("beatage_quizzes")
    .select("max_rounds, unlocked_at, status")
    .eq("id", quizId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!quiz) {
    throw new Error("QUIZ_NOT_FOUND");
  }

  // Unlock (or unlock-at-create pending) lifts the song cap when max_rounds is null.
  if (quiz.unlocked_at || quiz.status === "payment_pending") {
    return quiz.max_rounds ?? null;
  }
  if (typeof quiz.max_rounds === "number" && quiz.max_rounds > 0) {
    return quiz.max_rounds;
  }
  return DEFAULT_MAX_CURATED_TRACKS;
}

export async function countQuizCuratedTracks(quizId: string): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("beatage_curated_tracks")
    .select("id", { count: "exact", head: true })
    .eq("quiz_id", quizId);

  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

export async function resolveQuizTrackMetadata(
  input: QuizTrackInput,
): Promise<ResolvedQuizTrack> {
  const trackName = input.title.trim();
  const artistName = input.artist.trim() || null;
  let releaseYear: number | null =
    typeof input.releaseYear === "number" && Number.isFinite(input.releaseYear)
      ? input.releaseYear
      : null;
  let originalReleaseYear: number | null = releaseYear;
  let albumArtUrl = input.albumArtUrl?.trim() || null;
  let previewUrl = input.previewUrl?.trim() || null;
  let spotifyTrackId = input.spotifyTrackId?.trim() || null;

  try {
    if (spotifyTrackId) {
      const details = await getSpotifyTrackById(spotifyTrackId);
      if (details) {
        releaseYear = details.releaseYear ?? releaseYear;
        originalReleaseYear = details.originalReleaseYear ?? releaseYear;
        albumArtUrl = details.albumArtUrl ?? albumArtUrl;
        previewUrl = details.previewUrl ?? previewUrl;
        spotifyTrackId = details.id;
      }
    } else if (artistName) {
      const match = await findSpotifyTrack(trackName, artistName);
      if (match) {
        const details = await getSpotifyTrackById(match.id);
        if (details) {
          releaseYear = details.releaseYear ?? releaseYear;
          originalReleaseYear = details.originalReleaseYear ?? releaseYear;
          albumArtUrl = details.albumArtUrl ?? albumArtUrl;
          previewUrl = details.previewUrl ?? previewUrl;
          spotifyTrackId = details.id;
        }
      }
    }

    // iTunes fallback when Spotify left year (or preview) empty.
    if ((!releaseYear || !previewUrl) && artistName) {
      const itunes = await lookupItunesTrackMeta(trackName, artistName);
      if (itunes) {
        releaseYear = releaseYear ?? itunes.releaseYear;
        originalReleaseYear = originalReleaseYear ?? itunes.releaseYear;
        previewUrl = previewUrl ?? itunes.previewUrl;
      }
    }
  } catch {
    // Best-effort enrichment only — still store the curated title/artist.
  }

  return {
    trackName,
    artistName,
    spotifyTrackId,
    albumArtUrl,
    previewUrl,
    releaseYear,
    originalReleaseYear,
  };
}

async function insertCuratedTrackAdmin(
  quizId: string,
  resolved: ResolvedQuizTrack,
  sortOrder: number,
): Promise<{ error?: string; trackId?: string }> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("beatage_curated_tracks")
    .insert({
      quiz_id: quizId,
      sort_order: sortOrder,
      spotify_track_id: resolved.spotifyTrackId,
      track_name: resolved.trackName,
      artist_name: resolved.artistName,
      album_art_url: resolved.albumArtUrl,
      preview_url: resolved.previewUrl,
      release_year: resolved.releaseYear,
      original_release_year: resolved.originalReleaseYear ?? resolved.releaseYear,
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  return { trackId: typeof data?.id === "string" ? data.id : undefined };
}

async function nextSortOrder(quizId: string): Promise<number> {
  const admin = createAdminClient();
  const { data: maxRow, error } = await admin
    .from("beatage_curated_tracks")
    .select("sort_order")
    .eq("quiz_id", quizId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return typeof maxRow?.sort_order === "number" ? maxRow.sort_order + 1 : 0;
}

/**
 * Persist curated tracks after quiz create.
 * Uses service-role insert first — remote DB often lacks add_beatage_curated_track RPC.
 */
export async function seedCuratedTracksForQuiz(
  quizId: string,
  inputs: QuizTrackInput[],
): Promise<{ error?: string; saved: number }> {
  const limit = await getQuizCuratedTrackLimit(quizId);
  const existing = await countQuizCuratedTracks(quizId);
  const room = limit == null ? Number.POSITIVE_INFINITY : Math.max(0, limit - existing);

  let saved = 0;
  let sortOrder = await nextSortOrder(quizId);

  for (const input of inputs) {
    if (!input.title?.trim() || !input.artist?.trim()) continue;
    if (saved >= room) {
      return {
        error: `TRACK_LIMIT:${limit ?? DEFAULT_MAX_CURATED_TRACKS}`,
        saved,
      };
    }
    const resolved = await resolveQuizTrackMetadata(input);
    const result = await insertCuratedTrackAdmin(quizId, resolved, sortOrder);
    if (result.error) {
      return { error: `${resolved.trackName}: ${result.error}`, saved };
    }
    saved += 1;
    sortOrder += 1;
  }

  return { saved };
}

export async function addCuratedTrackToQuiz(
  _supabase: SupabaseClient,
  quizId: string,
  input: QuizTrackInput,
): Promise<{ error?: string; trackId?: string }> {
  const resolved = await resolveQuizTrackMetadata(input);

  const admin = createAdminClient();

  // Reuse an existing curated row for the same Spotify track (Auto Spotify).
  if (resolved.spotifyTrackId) {
    const { data: existingTrack } = await admin
      .from("beatage_curated_tracks")
      .select("id")
      .eq("quiz_id", quizId)
      .eq("spotify_track_id", resolved.spotifyTrackId)
      .maybeSingle();
    if (existingTrack && typeof existingTrack.id === "string") {
      return { trackId: existingTrack.id };
    }
  }

  // Auto Spotify grows the playlist from now-playing — do not apply curated caps.
  const { data: quizMeta } = await admin
    .from("beatage_quizzes")
    .select("source")
    .eq("id", quizId)
    .maybeSingle();
  const isAutoSpotify = quizMeta?.source === "spotify_live";

  if (!isAutoSpotify) {
    const limit = await getQuizCuratedTrackLimit(quizId);
    const existing = await countQuizCuratedTracks(quizId);
    if (limit != null && existing >= limit) {
      return { error: `TRACK_LIMIT:${limit}` };
    }
  }

  // Prefer admin insert: play RPCs (003) are often not applied on the remote DB yet.
  try {
    const sortOrder = await nextSortOrder(quizId);
    const inserted = await insertCuratedTrackAdmin(quizId, resolved, sortOrder);
    if (!inserted.error) {
      return { trackId: inserted.trackId };
    }

    // Fall back to RPC if admin insert fails for any reason.
    const { error } = await _supabase.rpc("add_beatage_curated_track", {
      p_quiz_id: quizId,
      p_track_name: resolved.trackName,
      p_artist_name: resolved.artistName,
      p_spotify_track_id: resolved.spotifyTrackId,
      p_album_art_url: resolved.albumArtUrl,
      p_preview_url: resolved.previewUrl,
      p_release_year: resolved.releaseYear,
      p_original_release_year: resolved.originalReleaseYear,
    });

    if (!error) {
      if (resolved.spotifyTrackId) {
        const { data: insertedRow } = await admin
          .from("beatage_curated_tracks")
          .select("id")
          .eq("quiz_id", quizId)
          .eq("spotify_track_id", resolved.spotifyTrackId)
          .maybeSingle();
        if (insertedRow && typeof insertedRow.id === "string") {
          return { trackId: insertedRow.id };
        }
      }
      return {};
    }

    return {
      error: `${inserted.error} (rpc fallback: ${error.message})`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Track insert failed.";
    return { error: message };
  }
}

/**
 * Fill missing release years for curated tracks (Spotify first, iTunes fallback).
 * Caps work per call so host page load stays snappy.
 */
export async function backfillMissingReleaseYearsForQuiz(
  quizId: string,
  limit = 5,
): Promise<number> {
  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("beatage_curated_tracks")
    .select(
      "id, track_name, artist_name, spotify_track_id, preview_url, release_year, original_release_year, album_art_url",
    )
    .eq("quiz_id", quizId)
    .is("release_year", null)
    .order("sort_order", { ascending: true })
    .limit(limit);

  if (error || !rows?.length) {
    return 0;
  }

  let updated = 0;
  for (const row of rows as Array<{
    id: string;
    track_name: string;
    artist_name: string | null;
    spotify_track_id: string | null;
    preview_url: string | null;
    release_year: number | null;
    original_release_year: number | null;
    album_art_url: string | null;
  }>) {
    const resolved = await resolveQuizTrackMetadata({
      title: row.track_name,
      artist: row.artist_name ?? "",
      previewUrl: row.preview_url ?? undefined,
      spotifyTrackId: row.spotify_track_id ?? undefined,
      albumArtUrl: row.album_art_url ?? undefined,
    });
    if (resolved.releaseYear == null) continue;

    const { error: updateError } = await admin
      .from("beatage_curated_tracks")
      .update({
        release_year: resolved.releaseYear,
        original_release_year:
          resolved.originalReleaseYear ?? resolved.releaseYear,
        spotify_track_id: resolved.spotifyTrackId ?? row.spotify_track_id,
        preview_url: resolved.previewUrl ?? row.preview_url,
        album_art_url: resolved.albumArtUrl ?? row.album_art_url,
      })
      .eq("id", row.id)
      .eq("quiz_id", quizId);

    if (!updateError) updated += 1;
  }

  return updated;
}
