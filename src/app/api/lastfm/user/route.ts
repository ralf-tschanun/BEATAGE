import { NextResponse } from "next/server";
import {
  isLastfmConfigured,
  lookupLastfmUser,
  normalizeLastfmUsername,
} from "@/lib/lastfm";

export async function GET(request: Request) {
  if (!isLastfmConfigured()) {
    return NextResponse.json(
      { ok: false, code: "not_configured", message: "Last.fm is not configured." },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const user = normalizeLastfmUsername(searchParams.get("user"));
  if (!user) {
    return NextResponse.json(
      { ok: false, code: "invalid_user", message: "Enter your Last.fm username." },
      { status: 400 },
    );
  }

  const result = await lookupLastfmUser(user);
  if (!result.ok) {
    const status =
      result.code === "invalid_user"
        ? 404
        : result.code === "not_configured"
          ? 503
          : 502;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json({ ok: true, username: result.username });
}
