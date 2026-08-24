type RequestLike = {
  headers: Headers;
};

function normalizeOrigin(value: string): string {
  return value.replace(/\/$/, "");
}

function originFromHost(hostHeader: string | null, protoHeader: string | null): string | null {
  const host = hostHeader?.split(",")[0]?.trim().toLowerCase();
  if (!host) return null;
  const proto = (protoHeader?.split(",")[0]?.trim() || "https").toLowerCase();
  return normalizeOrigin(`${proto}://${host}`);
}

/**
 * Prefer the host the browser actually used (custom domain) over a stale
 * NEXT_PUBLIC_SITE_URL that still points at *.vercel.app.
 */
export function getRequestSiteUrl(request: RequestLike): string {
  const fromRequest = originFromHost(
    request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
    request.headers.get("x-forwarded-proto"),
  );
  if (fromRequest) {
    try {
      const host = new URL(fromRequest).hostname;
      // Keep users on the public custom domain when they arrived that way.
      if (host === "beatage.gosmooth.eu" || host.endsWith(".gosmooth.eu")) {
        return fromRequest;
      }
    } catch {
      // Fall through to env / Vercel defaults.
    }
  }
  return getSiteUrl();
}

/** Public site origin for auth redirects, Spotify Connect, and invite links. */
export function getSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return normalizeOrigin(fromEnv);

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
