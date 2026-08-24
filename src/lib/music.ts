import {
  artistsLooselyMatch,
  looksLikeCompilationName,
  looksLikeRemasterLabel,
} from "@/lib/original-release-year";

export type ItunesTrackResult = {
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName: string | null;
  artworkUrl: string | null;
  /** ~30s preview clip; playable without an Apple ID */
  previewUrl: string | null;
  /** Parsed from iTunes `releaseDate` (YYYY-MM-DD). */
  releaseYear: number | null;
};

/** Prefer HTTPS for browser audio playback. */
export function normalizePreviewUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  return url.trim().replace(/^http:\/\//i, "https://");
}

/** Extract a 4-digit year from iTunes-style release dates. */
export function parseItunesReleaseYear(
  releaseDate: string | null | undefined,
): number | null {
  if (!releaseDate) return null;
  const match = /^(\d{4})/.exec(releaseDate.trim());
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) && year >= 1900 && year <= 2100 ? year : null;
}

/**
 * Best-effort iTunes lookup for release year (and preview) by title + artist.
 * Used as fallback when Spotify has no match / no album date.
 */
export async function lookupItunesTrackMeta(
  title: string,
  artist: string,
  country = "de",
  artistScope: "this_artist" | "any_artist" = "this_artist",
): Promise<{ releaseYear: number | null; previewUrl: string | null } | null> {
  const term = `${title} ${artist}`.trim();
  if (term.length < 2) return null;

  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", term);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", "5");
  url.searchParams.set("country", country);

  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      results?: Array<{
        trackName?: string;
        artistName?: string;
        collectionName?: string;
        previewUrl?: string;
        releaseDate?: string;
        kind?: string;
      }>;
    };

    const titleLower = title.trim().toLowerCase();
    const artistLower = artist.trim().toLowerCase();
    const songs = (data.results ?? []).filter(
      (item) =>
        item.kind === "song" &&
        Boolean(item.trackName?.trim()) &&
        Boolean(item.artistName?.trim()),
    );
    if (songs.length === 0) return null;

    const ranked = [...songs].sort((a, b) => {
      const aTitle = (a.trackName ?? "").toLowerCase();
      const bTitle = (b.trackName ?? "").toLowerCase();
      const aArtist = (a.artistName ?? "").toLowerCase();
      const bArtist = (b.artistName ?? "").toLowerCase();
      const aScore =
        (aTitle === titleLower ? 2 : aTitle.includes(titleLower) ? 1 : 0) +
        (aArtist === artistLower ? 2 : aArtist.includes(artistLower) ? 1 : 0);
      const bScore =
        (bTitle === titleLower ? 2 : bTitle.includes(titleLower) ? 1 : 0) +
        (bArtist === artistLower ? 2 : bArtist.includes(artistLower) ? 1 : 0);
      return bScore - aScore;
    });

    // this_artist: never fall back to other acts (Nancy Sinatra / Dagames bleed).
    // any_artist: allow other acts so original_recording finds the first hit.
    const pool =
      artistScope === "any_artist"
        ? ranked
        : ranked.filter((item) => artistsLooselyMatch(artist, item.artistName ?? ""));
    if (pool.length === 0) {
      return { releaseYear: null, previewUrl: null };
    }

    const years = pool
      .filter((item) => {
        const collection = item.collectionName ?? "";
        const trackName = item.trackName ?? "";
        if (looksLikeCompilationName(collection) || looksLikeCompilationName(trackName)) {
          return false;
        }
        if (looksLikeRemasterLabel(collection) || looksLikeRemasterLabel(trackName)) {
          return false;
        }
        return true;
      })
      .map((item) => parseItunesReleaseYear(item.releaseDate))
      .filter((year): year is number => year != null);

    const bestClean =
      pool.find((item) => {
        const collection = item.collectionName ?? "";
        const trackName = item.trackName ?? "";
        if (looksLikeCompilationName(collection) || looksLikeCompilationName(trackName)) {
          return false;
        }
        if (looksLikeRemasterLabel(collection) || looksLikeRemasterLabel(trackName)) {
          return false;
        }
        return true;
      }) ?? pool[0];

    // Prefer earliest clean year; if remaster filters wiped them, fall back to
    // the best pool hit (often a deluxe that still carries the original date).
    const poolYears = pool
      .map((item) => parseItunesReleaseYear(item.releaseDate))
      .filter((year): year is number => year != null);

    return {
      releaseYear:
        years.length > 0
          ? Math.min(...years)
          : poolYears.length > 0
            ? Math.min(...poolYears)
            : null,
      previewUrl: normalizePreviewUrl(bestClean?.previewUrl ?? null),
    };
  } catch {
    return null;
  }
}
