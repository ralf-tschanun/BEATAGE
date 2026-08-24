import { looksLikeCompilationName, looksLikeRemasterLabel, stripRecordingVersionLabel } from "@/lib/original-release-year";

export type SpotifyTrackMatch = {
  id: string;
  url: string;
  uri: string;
  name: string;
  artistName: string | null;
};

export type SpotifyTrackDetails = SpotifyTrackMatch & {
  albumArtUrl: string | null;
  previewUrl: string | null;
  releaseYear: number | null;
  releaseDate: string | null;
  originalReleaseYear: number | null;
  albumName: string | null;
  albumType: string | null;
};

function parseReleaseYear(releaseDate: string | null | undefined): number | null {
  if (!releaseDate) return null;
  const match = /^(\d{4})/.exec(releaseDate.trim());
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

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

/** Fetch track metadata including release year (best-effort original = album release). */
export async function getSpotifyTrackById(
  trackId: string,
  market = "DE",
): Promise<SpotifyTrackDetails | null> {
  const id = trackId.trim();
  if (!id) return null;

  const token = await getClientCredentialsToken();
  if (!token) return null;

  try {
    const response = await fetch(
      `https://api.spotify.com/v1/tracks/${encodeURIComponent(id)}?market=${encodeURIComponent(market)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );
    if (!response.ok) return null;

    const data = (await response.json()) as {
      id?: string;
      name?: string;
      uri?: string;
      preview_url?: string | null;
      external_urls?: { spotify?: string };
      artists?: Array<{ name?: string }>;
      album?: {
        name?: string;
        album_type?: string;
        release_date?: string;
        images?: Array<{ url?: string }>;
      };
    };

    if (!data.id || !data.name) return null;

    const releaseDate = data.album?.release_date ?? null;
    const releaseYear = parseReleaseYear(releaseDate);
    const urlFromApi = data.external_urls?.spotify?.trim();

    return {
      id: data.id,
      url:
        urlFromApi && urlFromApi.startsWith("http")
          ? urlFromApi
          : `https://open.spotify.com/track/${data.id}`,
      uri:
        typeof data.uri === "string" && data.uri
          ? data.uri
          : `spotify:track:${data.id}`,
      name: data.name.trim(),
      artistName: data.artists?.[0]?.name?.trim() || null,
      albumArtUrl: data.album?.images?.[0]?.url ?? null,
      previewUrl: data.preview_url ?? null,
      releaseYear,
      releaseDate,
      originalReleaseYear: releaseYear,
      albumName: data.album?.name?.trim() || null,
      albumType: data.album?.album_type?.trim() || null,
    };
  } catch {
    return null;
  }
}

/**
 * Scan Spotify search hits for album/single years, skipping compilations and remaster labels.
 * Used to recover an original year when the playing track is a remaster or sampler.
 */
export async function searchSpotifyOriginalYearCandidates(
  title: string,
  artist: string,
  market = "DE",
): Promise<number[]> {
  const query = buildSearchQuery(stripRecordingVersionLabel(title), artist);
  if (query.length < 2) return [];

  const token = await getClientCredentialsToken();
  if (!token) return [];

  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "track");
  url.searchParams.set("limit", "10");
  url.searchParams.set("market", market);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!response.ok) return [];

    const data = (await response.json()) as {
      tracks?: {
        items?: Array<{
          name?: string;
          album?: {
            name?: string;
            album_type?: string;
            release_date?: string;
          };
        }>;
      };
    };

    const years: number[] = [];
    for (const item of data.tracks?.items ?? []) {
      const albumType = item.album?.album_type?.toLowerCase() ?? "";
      const albumName = item.album?.name ?? "";
      const trackName = item.name ?? "";
      if (albumType === "compilation") continue;
      if (looksLikeCompilationName(albumName) || looksLikeCompilationName(trackName)) {
        continue;
      }
      if (looksLikeRemasterLabel(trackName) || looksLikeRemasterLabel(albumName)) {
        continue;
      }
      const year = parseReleaseYear(item.album?.release_date);
      if (year != null) years.push(year);
    }
    return years;
  } catch {
    return [];
  }
}

