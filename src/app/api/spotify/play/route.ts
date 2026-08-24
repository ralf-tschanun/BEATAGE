import { NextResponse } from "next/server";
import {
  isSpotifyConnectConfigured,
  playSpotifyTrackForUser,
} from "@/lib/spotify-connect";

export async function POST(request: Request) {
  if (!isSpotifyConnectConfigured()) {
    return NextResponse.json(
      { ok: false, code: "failed", message: "Spotify is not configured." },
      { status: 503 },
    );
  }

  let body: { uri?: string } = {};
  try {
    body = (await request.json()) as { uri?: string };
  } catch {
    return NextResponse.json(
      { ok: false, code: "failed", message: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const uri = typeof body.uri === "string" ? body.uri.trim() : "";
  const trackUri = uri.replace(/:play$/i, "");
  if (!trackUri.startsWith("spotify:track:")) {
    return NextResponse.json(
      { ok: false, code: "failed", message: "uri must be a spotify:track:… value." },
      { status: 400 },
    );
  }

  const result = await playSpotifyTrackForUser(trackUri);
  if (!result.ok) {
    const status =
      result.code === "not_connected"
        ? 401
        : result.code === "premium_required"
          ? 403
          : result.code === "no_device"
            ? 409
            : 502;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json({ ok: true, deviceId: result.deviceId ?? null });
}
