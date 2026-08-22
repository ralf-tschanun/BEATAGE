/** Extract a BEATAGE join code from a scanned QR payload (URL or raw code). */
const JOIN_CODE_RE = /^[A-Za-z0-9]{4,12}$/;
const PATH_CODE_RE = /(?:^|\/)(?:j|c|join)\/([A-Za-z0-9]{4,12})(?:\/|$|[?#])/i;

export function joinCodeFromQrPayload(raw: string): string | null {
  const text = raw.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (!text) return null;

  try {
    const url = new URL(text);
    const fromPath = url.pathname.match(PATH_CODE_RE);
    if (fromPath?.[1]) return fromPath[1].toUpperCase();

    const fromHash = url.hash.match(PATH_CODE_RE);
    if (fromHash?.[1]) return fromHash[1].toUpperCase();

    const fromQuery =
      url.searchParams.get("code") ??
      url.searchParams.get("join") ??
      url.searchParams.get("joinCode");
    if (fromQuery && JOIN_CODE_RE.test(fromQuery.trim())) {
      return fromQuery.trim().toUpperCase();
    }
  } catch {
    // Not an absolute URL — try relative / raw matching.
  }

  const pathMatch = text.match(PATH_CODE_RE);
  if (pathMatch?.[1]) return pathMatch[1].toUpperCase();

  if (JOIN_CODE_RE.test(text)) return text.toUpperCase();

  return null;
}
