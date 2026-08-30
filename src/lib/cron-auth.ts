import type { NextRequest } from "next/server";

/** Vercel Cron sends Authorization: Bearer CRON_SECRET; query ?secret= works locally. */
export function isCronAuthorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  const auth = request.headers.get("authorization")?.trim() ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const querySecret = request.nextUrl.searchParams.get("secret")?.trim() ?? "";
  const provided = bearer || querySecret;
  return provided === expected;
}
