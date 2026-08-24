/** Public custom domain — never use *.vercel.app for OAuth / redirects. */
export const CANONICAL_SITE_URL = "https://beatage.gosmooth.eu";

type RequestLike = {
  headers: Headers;
};

function normalizeOrigin(value: string): string {
  return value.replace(/\/$/, "");
}

function isVercelAppHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "vercel.app" || host.endsWith(".vercel.app");
}

function isGosmoothHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "beatage.gosmooth.eu" || host.endsWith(".gosmooth.eu");
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
 * Never return a *.vercel.app origin — fall through to the canonical domain.
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
      if (isGosmoothHostname(host)) {
        return fromRequest;
      }
      // Ignore *.vercel.app (and any other host) — use env / canonical below.
    } catch {
      // Fall through to env / canonical defaults.
    }
  }
  return getSiteUrl();
}

/** Public site origin for auth redirects, Spotify Connect, and invite links. */
export function getSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) {
    const normalized = normalizeOrigin(fromEnv);
    try {
      const host = new URL(normalized).hostname;
      // Misconfigured deploy: rewrite vercel.app → public domain.
      if (isVercelAppHostname(host)) {
        return CANONICAL_SITE_URL;
      }
    } catch {
      // Use the env value as-is if it is not a valid URL.
    }
    return normalized;
  }

  // Hosted (Vercel etc.): always the custom domain — never VERCEL_URL / *.vercel.app.
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    return CANONICAL_SITE_URL;
  }

  // Spotify OAuth allows HTTP only for loopback IPs — not "localhost".
  return "http://127.0.0.1:3001";
}

/** Allow only in-app relative paths (no protocol-relative or external URLs). */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
