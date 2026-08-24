import { NextResponse } from "next/server";
import {
  isSpotifyConnectConfigured,
  skipToNextSpotifyTrackForUser,
} from "@/lib/spotify-connect";

export async function POST() {
  if (!isSpotifyConnectConfigured()) {
    return NextResponse.json(
      { ok: false, code: "failed", message: "Spotify is not configured." },
      { status: 503 },
    );
  }

  const result = await skipToNextSpotifyTrackForUser();
  if (!result.ok) {
    const status =
      result.code === "not_connected"
        ? 401
        : result.code === "premium_required"
          ? 403
          : 502;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json({ ok: true });
}
