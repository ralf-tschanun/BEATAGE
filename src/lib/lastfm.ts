/**
 * Last.fm Now Playing (via Spotify scrobble) — no Spotify OAuth required.
 * Docs: https://www.last.fm/api/show/user.getRecentTracks
 */

export type LastfmNowPlayingTrack = {
  /** Stable id for debounce / same-track checks (not a Spotify id). */
  trackKey: string;
  title: string;
  artist: string;
  albumArtUrl: string | null;
  isPlaying: boolean;
};

function getLastfmApiKey(): string | null {
  const key = process.env.LASTFM_API_KEY?.trim() ?? "";
  return key || null;
}

export function isLastfmConfigured(): boolean {
  return getLastfmApiKey() != null;
}

export function normalizeLastfmUsername(raw: string | null | undefined): string {
  return (raw ?? "").trim().replace(/^@/, "");
}

/** Fingerprint for title+artist — used when Spotify track id is not yet known. */
export function lastfmTrackKey(title: string, artist: string): string {
  const norm = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return `lfm:${norm(artist)}|${norm(title)}`;
}

type LastfmRecentTrack = {
  name?: string;
  artist?: { "#text"?: string; name?: string } | string;
  image?: Array<{ "#text"?: string; size?: string }>;
  "@attr"?: { nowplaying?: string };
};

function parseArtist(raw: LastfmRecentTrack["artist"]): string {
  if (!raw) return "";
  if (typeof raw === "string") return raw.trim();
  return (raw["#text"] ?? raw.name ?? "").trim();
}

function pickAlbumArt(
  images: LastfmRecentTrack["image"],
): string | null {
  if (!Array.isArray(images) || images.length === 0) return null;
  const preferred =
    images.find((img) => img.size === "extralarge") ??
    images.find((img) => img.size === "large") ??
    images[images.length - 1];
  const url = preferred?.["#text"]?.trim() ?? "";
  return url || null;
}

/**
 * Read the user's currently playing (or most recent) track from Last.fm.
 * Spotify must be linked to Last.fm in the Spotify app for live updates.
 */
type LastfmNowPlayingResult =
  | { ok: true; playing: false }
  | { ok: true; playing: true; track: LastfmNowPlayingTrack }
  | { ok: false; code: "not_configured" | "invalid_user" | "failed"; message: string };

/** Short in-memory TTL so poll + sync on the same instance share one Last.fm call. */
const LASTFM_NOW_PLAYING_CACHE_MS = 3000;
const lastfmNowPlayingCache = new Map<
  string,
  { at: number; result: LastfmNowPlayingResult }
>();

export async function getLastfmCurrentlyPlaying(
  username: string,
): Promise<LastfmNowPlayingResult> {
  const apiKey = getLastfmApiKey();
  if (!apiKey) {
    return {
      ok: false,
      code: "not_configured",
      message: "Last.fm is not configured on this server.",
    };
  }

  const user = normalizeLastfmUsername(username);
  if (!user) {
    return {
      ok: false,
      code: "invalid_user",
      message: "Enter your Last.fm username.",
    };
  }

  const cacheKey = user.toLowerCase();
  const cached = lastfmNowPlayingCache.get(cacheKey);
  if (cached && Date.now() - cached.at < LASTFM_NOW_PLAYING_CACHE_MS) {
    return cached.result;
  }

  const url = new URL("https://ws.audioscrobbler.com/2.0/");
  url.searchParams.set("method", "user.getrecenttracks");
  url.searchParams.set("user", user);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  try {
    const response = await fetch(url.toString(), { cache: "no-store" });
    const data = (await response.json().catch(() => null)) as {
      error?: number;
      message?: string;
      recenttracks?: { track?: LastfmRecentTrack | LastfmRecentTrack[] };
    } | null;

    if (!response.ok || data?.error) {
      const message = data?.message?.trim() || "Could not read Last.fm now playing.";
      if (data?.error === 6 || /user not found/i.test(message)) {
        return { ok: false, code: "invalid_user", message: "Last.fm user not found." };
      }
      return { ok: false, code: "failed", message: message.slice(0, 160) };
    }

    const raw = data?.recenttracks?.track;
    const trackRow = Array.isArray(raw) ? raw[0] : raw;
    if (!trackRow) {
      const result = { ok: true as const, playing: false as const };
      lastfmNowPlayingCache.set(cacheKey, { at: Date.now(), result });
      return result;
    }

    const title = trackRow.name?.trim() ?? "";
    const artist = parseArtist(trackRow.artist);
    if (!title || !artist) {
      const result = { ok: true as const, playing: false as const };
      lastfmNowPlayingCache.set(cacheKey, { at: Date.now(), result });
      return result;
    }

    const nowPlaying = trackRow["@attr"]?.nowplaying === "true";
    // Only open rounds for true now-playing — recent history alone would re-open old songs.
    if (!nowPlaying) {
      const result = { ok: true as const, playing: false as const };
      lastfmNowPlayingCache.set(cacheKey, { at: Date.now(), result });
      return result;
    }

    const result = {
      ok: true as const,
      playing: true as const,
      track: {
        trackKey: lastfmTrackKey(title, artist),
        title,
        artist,
        albumArtUrl: pickAlbumArt(trackRow.image),
        isPlaying: true,
      },
    };
    lastfmNowPlayingCache.set(cacheKey, { at: Date.now(), result });
    return result;
  } catch {
    return {
      ok: false,
      code: "failed",
      message: "Could not reach Last.fm.",
    };
  }
}
