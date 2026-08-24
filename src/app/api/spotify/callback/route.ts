import { NextResponse } from "next/server";
import {
  exchangeSpotifyAuthCode,
  playSpotifyTrackForUser,
  writeSpotifyUserTokens,
} from "@/lib/spotify-connect";
import { getSiteUrl, safeNextPath } from "@/lib/site-url";

type ConnectState = {
  next?: string;
  play?: string;
};

function parseState(raw: string | null): ConnectState {
  if (!raw) return {};
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as ConnectState;
    return {
      next: typeof parsed.next === "string" ? parsed.next : "/",
      play: typeof parsed.play === "string" ? parsed.play : "",
    };
  } catch {
    return {};
  }
}

export async function GET(request: Request) {
  const siteUrl = getSiteUrl();
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = parseState(searchParams.get("state"));
  const nextPath = safeNextPath(state.next);

  if (error || !code) {
    const url = new URL(nextPath, siteUrl);
    url.searchParams.set("spotify", error === "access_denied" ? "denied" : "error");
    return NextResponse.redirect(url);
  }

  const tokens = await exchangeSpotifyAuthCode(code);
  if (!tokens) {
    const url = new URL(nextPath, siteUrl);
    url.searchParams.set("spotify", "error");
    return NextResponse.redirect(url);
  }

  await writeSpotifyUserTokens(tokens);

  const playUri =
    state.play?.startsWith("spotify:track:") ? state.play : "";
  if (playUri) {
    await playSpotifyTrackForUser(playUri);
  }

  const url = new URL(nextPath, siteUrl);
  url.searchParams.set("spotify", "connected");
  // So the host UI can show pause on all logos after OAuth autoplay.
  if (playUri) {
    url.searchParams.set("spotify_play", playUri);
  }
  return NextResponse.redirect(url);
}
