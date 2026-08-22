export type SpotifyTrackMatch = {
  id: string;
  url: string;
  uri: string;
  name: string;
  artistName: string | null;
};

type SpotifyTokenCache = {
  accessToken: string;
  expiresAtMs: number;
};

let tokenCache: SpotifyTokenCache | null = null;

function getSpotifyCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function isSpotifyConfigured(): boolean {
  return getSpotifyCredentials() != null;
}

async function getClientCredentialsToken(): Promise<string | null> {
  const credentials = getSpotifyCredentials();
  if (!credentials) return null;

  const now = Date.now();
  if (tokenCache && tokenCache.expiresAtMs > now + 30_000) {
    return tokenCache.accessToken;
  }

  const basic = Buffer.from(
    `${credentials.clientId}:${credentials.clientSecret}`,
  ).toString("base64");

  try {
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
    });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return null;

    const expiresInSec =
      typeof data.expires_in === "number" && data.expires_in > 0
        ? data.expires_in
        : 3600;
    tokenCache = {
      accessToken: data.access_token,
      expiresAtMs: now + expiresInSec * 1000,
    };
    return data.access_token;
  } catch {
    return null;
  }
}

function buildSearchQuery(title: string, artist: string): string {
  const cleanTitle = title.trim().replace(/"/g, "");
  const cleanArtist = artist.trim().replace(/"/g, "");
  if (!cleanTitle) return "";
  if (!cleanArtist) return `track:"${cleanTitle}"`;
  return `track:"${cleanTitle}" artist:"${cleanArtist}"`;
}

/** Best-effort Spotify track match for title + artist (may return null). */
export async function findSpotifyTrack(
  title: string,
  artist: string,
  market = "DE",
): Promise<SpotifyTrackMatch | null> {
  const query = buildSearchQuery(title, artist);
  if (query.length < 2) return null;

  const token = await getClientCredentialsToken();
  if (!token) return null;

  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "track");
  url.searchParams.set("limit", "5");
  url.searchParams.set("market", market);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      tracks?: {
        items?: Array<{
          id?: string;
          name?: string;
          uri?: string;
          external_urls?: { spotify?: string };
          artists?: Array<{ name?: string }>;
        }>;
      };
    };

    const items = data.tracks?.items ?? [];
    const first = items.find(
      (item) =>
        typeof item.id === "string" &&
        item.id.length > 0 &&
        typeof item.name === "string" &&
        item.name.trim().length > 0,
    );
    if (!first?.id) return null;

    const urlFromApi = first.external_urls?.spotify?.trim();
    const openUrl =
      urlFromApi && urlFromApi.startsWith("http")
        ? urlFromApi
        : `https://open.spotify.com/track/${first.id}`;

    return {
      id: first.id,
      url: openUrl,
      uri: typeof first.uri === "string" && first.uri ? first.uri : `spotify:track:${first.id}`,
      name: first.name!.trim(),
      artistName: first.artists?.[0]?.name?.trim() || null,
    };
  } catch {
    return null;
  }
}
