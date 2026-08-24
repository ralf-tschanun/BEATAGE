import { NextResponse } from "next/server";
import {
  getValidSpotifyUserAccessToken,
  isSpotifyConnectConfigured,
} from "@/lib/spotify-connect";

export async function GET() {
  if (!isSpotifyConnectConfigured()) {
    return NextResponse.json({ configured: false, connected: false });
  }
  const token = await getValidSpotifyUserAccessToken();
  return NextResponse.json({
    configured: true,
    connected: Boolean(token),
  });
}
