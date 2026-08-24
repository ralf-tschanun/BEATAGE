import { NextResponse } from "next/server";
import {
  isSpotifyConnectConfigured,
  pauseSpotifyPlaybackForUser,
} from "@/lib/spotify-connect";

export async function POST(request: Request) {
  if (!isSpotifyConnectConfigured()) {
    return NextResponse.json(
      { ok: false, code: "failed", message: "Spotify is not configured." },
      { status: 503 },
    );
  }

  let deviceId: string | null = null;
  try {
    const body = (await request.json()) as { deviceId?: string };
    if (typeof body.deviceId === "string" && body.deviceId.trim()) {
      deviceId = body.deviceId.trim();
    }
  } catch {
    // body optional
  }

  const result = await pauseSpotifyPlaybackForUser(deviceId);
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

  return NextResponse.json({ ok: true });
}
