import { NextResponse } from "next/server";
import {
  getCurrentlyPlayingForUser,
  isSpotifyConnectConfigured,
} from "@/lib/spotify-connect";

export async function GET() {
  if (!isSpotifyConnectConfigured()) {
    return NextResponse.json(
      { ok: false, code: "failed", message: "Spotify is not configured." },
      { status: 503 },
    );
  }

  const result = await getCurrentlyPlayingForUser();
  if (!result.ok) {
    const status = result.code === "not_connected" ? 401 : 502;
    return NextResponse.json(result, { status });
  }

  if (!result.playing) {
    return NextResponse.json({ ok: true, playing: false });
  }

  return NextResponse.json({
    ok: true,
    playing: true,
    track: result.track,
  });
}
