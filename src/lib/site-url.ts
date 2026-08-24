/** Public site origin for auth redirects, Spotify Connect, and invite links. */
export function getSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  // Vercel sets VERCEL_URL without scheme (e.g. beatage-xxx.vercel.app).
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${host}`;
  }

  // Spotify OAuth allows HTTP only for loopback IPs — not "localhost".
  return "http://127.0.0.1:3001";
}

/** Allow only in-app relative paths (no protocol-relative or external URLs). */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
