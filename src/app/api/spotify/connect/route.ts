import { NextResponse } from "next/server";
import {
  buildSpotifyConnectUrl,
  isSpotifyConnectConfigured,
} from "@/lib/spotify-connect";
import { safeNextPath } from "@/lib/site-url";

export async function GET(request: Request) {
  if (!isSpotifyConnectConfigured()) {
    return NextResponse.json(
      { error: "Spotify is not configured on this server." },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const next = safeNextPath(searchParams.get("next"));
  const playUri = searchParams.get("play")?.trim() ?? "";
  const statePayload = Buffer.from(
    JSON.stringify({
      next,
      play: playUri.startsWith("spotify:track:") ? playUri : "",
      t: Date.now(),
    }),
    "utf8",
  ).toString("base64url");

  const authorizeUrl = buildSpotifyConnectUrl({
    state: statePayload,
    request,
  });
  if (!authorizeUrl) {
    return NextResponse.json(
      { error: "Spotify is not configured on this server." },
      { status: 503 },
    );
  }

  return NextResponse.redirect(authorizeUrl);
}
