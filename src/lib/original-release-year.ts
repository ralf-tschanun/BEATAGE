/**
 * Best-effort original release year for a recording (not remaster / sampler year).
 * MusicBrainz is the primary source; Spotify/iTunes years are extra candidates.
 */

const COMPILATION_HINT =
  /\b(greatest hits|best of|the best|hits|anthology|collection|gold|platinum|ultimate|essentials|now that's|now thats|sampler|mixtape|soundtrack|ost|karaoke|tribute|covers?)\b/i;

/** Trailing version labels (studio remasters, edits, short "live" tags). */
const VERSION_SUFFIX =
  /\s*(?:[-([]\s*)?(?:remaster(?:ed)?(?:\s+\d{4})?|re-?master(?:ed)?|deluxe(?:\s+edition)?|super\s+deluxe|expanded(?:\s+edition)?|anniversary(?:\s+edition)?|re-?issue|re-?release|bonus\s+track|radio\s+edit|single\s+version|album\s+version|live(?:\s+at\b.*)?|acoustic|demo)\s*(?:[)\]])?\s*$/i;

/**
 * Longer live suffixes Spotify/iTunes use, e.g.
 * " - Live In Hyde Park / September 1976" or " (Live at Wembley, 1986)".
 */
const LIVE_EVENT_SUFFIX =
  /\s*[-–—(]\s*live\b.*$/i;

const YEAR_TOKEN = /\b((?:19|20)\d{2})\b/;

export function stripRecordingVersionLabel(title: string): string {
  let cleaned = title.trim();
  for (let i = 0; i < 3; i += 1) {
    let next = cleaned.replace(LIVE_EVENT_SUFFIX, "").trim();
    next = next.replace(VERSION_SUFFIX, "").trim();
    if (next === cleaned || next.length < 2) break;
    cleaned = next;
  }
  return cleaned || title.trim();
}

export function looksLikeCompilationName(name: string | null | undefined): boolean {
  if (!name?.trim()) return false;
  return COMPILATION_HINT.test(name);
}

export function looksLikeRemasterLabel(name: string | null | undefined): boolean {
  if (!name?.trim()) return false;
  return /\b(re-?master(?:ed)?|deluxe|anniversary|expanded|re-?issue|re-?release)\b/i.test(
    name,
  );
}

/** Normalize artist names for loose equality (accents, punctuation, featuring). */
export function normalizeArtistName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\b(feat\.?|ft\.?|featuring|with)\b.*$/i, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when result artist matches the queried artist (primary name / contains). */
export function artistsLooselyMatch(
  queryArtist: string,
  resultArtist: string,
): boolean {
  const query = normalizeArtistName(queryArtist);
  const result = normalizeArtistName(resultArtist);
  if (!query || !result) return false;
  if (query === result) return true;
  if (result.includes(query) || query.includes(result)) return true;
  // Multi-artist Spotify strings: "Queen, David Bowie"
  const parts = result.split(/\s+/).filter(Boolean);
  if (parts.length >= 1 && query.split(/\s+/).every((token) => result.includes(token))) {
    return true;
  }
  return false;
}

/**
 * Year embedded in a live / performance title (not remaster years).
 * e.g. "You Take My Breath Away - Live In Hyde Park / September 1976"
 */
export function extractPerformanceYearFromTitle(
  title: string | null | undefined,
): number | null {
  if (!title?.trim()) return null;
  const text = title.trim();
  const maxYear = new Date().getFullYear();

  // Ignore explicit remaster years in the title.
  if (/\b(re-?master(?:ed)?)\b/i.test(text)) {
    const withoutRemaster = text.replace(
      /\b(?:re-?master(?:ed)?(?:\s+\d{4})?)\b/gi,
      " ",
    );
    return extractPerformanceYearFromTitle(withoutRemaster);
  }

  const liveIdx = text.search(/\blive\b/i);
  if (liveIdx >= 0) {
    const afterLive = text.slice(liveIdx);
    const match = YEAR_TOKEN.exec(afterLive);
    if (match) {
      const year = Number(match[1]);
      if (year >= 1900 && year <= maxYear) return year;
    }
    const beforeLive = text.slice(0, liveIdx);
    const beforeMatch = [...beforeLive.matchAll(new RegExp(YEAR_TOKEN.source, "g"))].pop();
    if (beforeMatch) {
      const year = Number(beforeMatch[1]);
      if (year >= 1900 && year <= maxYear) return year;
    }
  }

  return null;
}

export function pickOriginalReleaseYear(
  candidates: Array<number | null | undefined>,
  albumYear: number | null,
): number | null {
  const maxYear = new Date().getFullYear();
  const years = candidates.filter(
    (year): year is number =>
      typeof year === "number" && Number.isFinite(year) && year >= 1900 && year <= maxYear,
  );
  if (years.length === 0) return albumYear;
  const earliest = Math.min(...years);
  if (albumYear != null && earliest > albumYear) return albumYear;
  return earliest;
}

/**
 * MusicBrainz first-release-date for an official recording.
 * - this_artist: restrict to the played artist (covers stay with that act)
 * - any_artist: earliest recording of the song (original across covers)
 */
export async function lookupMusicBrainzOriginalYear(
  title: string,
  artist: string,
  scope: "this_artist" | "any_artist" = "this_artist",
): Promise<number | null> {
  const recording = stripRecordingVersionLabel(title);
  if (recording.length < 2) return null;

  const artistName = artist.trim();
  const safeTitle = recording.replace(/"/g, "");
  const query =
    scope === "any_artist" || !artistName
      ? `recording:"${safeTitle}" AND status:official`
      : `recording:"${safeTitle}" AND artist:"${artistName.replace(/"/g, "")}" AND status:official`;

  const url = new URL("https://musicbrainz.org/ws/2/recording");
  url.searchParams.set("query", query);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", "10");

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "BEATAGE/1.0 (https://beatage.gosmooth.eu)",
      },
      cache: "no-store",
    });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      recordings?: Array<{
        title?: string;
        "first-release-date"?: string;
        score?: number;
        "artist-credit"?: Array<{ name?: string; artist?: { name?: string } }>;
      }>;
    };

    const minScore = scope === "any_artist" ? 50 : 60;
    const years = (data.recordings ?? [])
      .filter((row) => (row.score ?? 0) >= minScore)
      .filter((row) => {
        if (scope !== "this_artist" || !artistName) return true;
        const credit =
          row["artist-credit"]?.map((c) => c.name ?? c.artist?.name ?? "").join(" ") ??
          "";
        return artistsLooselyMatch(artistName, credit);
      })
      .map((row) => parseYearPrefix(row["first-release-date"]))
      .filter((year): year is number => year != null);

    if (years.length === 0) return null;
    return Math.min(...years);
  } catch {
    return null;
  }
}

function parseYearPrefix(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{4})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
}
