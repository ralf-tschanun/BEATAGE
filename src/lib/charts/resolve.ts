import { normalizePreviewUrl } from "@/lib/music";
import type { ChartCountry } from "@/lib/charts/countries";
import {
  getLatestNumberOneSong,
  getNumberOneSong,
} from "@/lib/charts/lookup";

export type ChartNumberOne = {
  country: ChartCountry;
  chartDate: string;
  title: string;
  artist: string;
  /** Stable key for deduplicating the same hit across weeks/people. */
  chartKey: string;
};

const BILLBOARD_BASE =
  "https://raw.githubusercontent.com/mhollingshead/billboard-hot-100/main";

let cachedValidDates: string[] | null = null;

async function loadBillboardValidDates(): Promise<string[]> {
  if (cachedValidDates) return cachedValidDates;
  const response = await fetch(`${BILLBOARD_BASE}/valid_dates.json`, {
    next: { revalidate: 86400 },
  });
  if (!response.ok) {
    throw new Error("CHART_LOOKUP_FAILED");
  }
  const dates = (await response.json()) as string[];
  cachedValidDates = dates;
  return dates;
}

/** Latest Billboard chart date on or before the birthday (week the date falls into). */
function billboardChartDateForBirthday(
  birthdayIso: string,
  validDates: string[],
): string | null {
  if (validDates.length === 0) return null;
  if (birthdayIso < validDates[0]!) return null;

  let lo = 0;
  let hi = validDates.length - 1;
  let answer = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const value = validDates[mid]!;
    if (value <= birthdayIso) {
      answer = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return answer >= 0 ? validDates[answer]! : null;
}

function chartKeyFor(country: ChartCountry, title: string, artist: string): string {
  const norm = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return `${country}:${norm(title)}|${norm(artist)}`;
}

async function fetchBillboardNumberOneForDate(
  chartDate: string,
): Promise<ChartNumberOne | null> {
  const response = await fetch(`${BILLBOARD_BASE}/date/${chartDate}.json`, {
    next: { revalidate: 86400 },
  });
  if (!response.ok) return null;

  const payload = (await response.json()) as {
    date?: string;
    data?: Array<{ song?: string; artist?: string; this_week?: number }>;
  };
  const numberOne = (payload.data ?? []).find((row) => row.this_week === 1);
  const title = numberOne?.song?.trim();
  const artist = numberOne?.artist?.trim();
  if (!title || !artist) return null;

  return {
    country: "US",
    chartDate,
    title,
    artist,
    chartKey: chartKeyFor("US", title, artist),
  };
}

async function getBillboardNumberOne(birthdayIso: string): Promise<ChartNumberOne | null> {
  const validDates = await loadBillboardValidDates();
  const chartDate = billboardChartDateForBirthday(birthdayIso, validDates);
  if (!chartDate) return null;
  return fetchBillboardNumberOneForDate(chartDate);
}

async function getLatestBillboardNumberOne(): Promise<ChartNumberOne | null> {
  const validDates = await loadBillboardValidDates();
  if (validDates.length === 0) return null;
  const chartDate = validDates[validDates.length - 1]!;
  return fetchBillboardNumberOneForDate(chartDate);
}

function fromStoredHit(
  country: ChartCountry,
  hit: { validFrom: string; title: string; artist: string },
): ChartNumberOne {
  return {
    country,
    chartDate: hit.validFrom,
    title: hit.title,
    artist: hit.artist,
    chartKey: chartKeyFor(country, hit.title, hit.artist),
  };
}

/** Resolve weekly #1 for a birthday in the selected chart market. */
export async function getChartNumberOne(
  country: ChartCountry,
  birthdayIso: string,
): Promise<ChartNumberOne | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdayIso)) return null;

  try {
    if (country === "US") {
      return await getBillboardNumberOne(birthdayIso);
    }

    if (country === "DE" || country === "AT" || country === "GB") {
      const hit = await getNumberOneSong(country, birthdayIso);
      if (hit) {
        return fromStoredHit(country, hit);
      }

      // Austria starts ~1989; for uncovered dates fall back to German charts.
      if (country === "AT") {
        const deHit = await getNumberOneSong("DE", birthdayIso);
        if (!deHit) return null;
        return fromStoredHit("DE", deHit);
      }

      return null;
    }
  } catch {
    return null;
  }
  return null;
}

/** Most recent available chart #1 for the market (current week / latest import). */
export async function getLatestChartNumberOne(
  country: ChartCountry,
): Promise<ChartNumberOne | null> {
  try {
    if (country === "US") {
      return await getLatestBillboardNumberOne();
    }
    if (country === "DE" || country === "AT" || country === "GB") {
      const hit = await getLatestNumberOneSong(country);
      if (hit) return fromStoredHit(country, hit);
      if (country === "AT") {
        const deHit = await getLatestNumberOneSong("DE");
        if (deHit) return fromStoredHit("DE", deHit);
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Lookup chart #1 for a date; if that date is in the future or has no hit
 * (e.g. +25 years for someone under 25), use the latest available #1.
 */
export async function resolveChartNumberOneWithFallback(
  country: ChartCountry,
  lookupDateIso: string,
): Promise<{ hit: ChartNumberOne; usedLatestFallback: boolean } | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lookupDateIso)) return null;

  const today = new Date().toISOString().slice(0, 10);
  if (lookupDateIso <= today) {
    const hit = await getChartNumberOne(country, lookupDateIso);
    if (hit) return { hit, usedLatestFallback: false };
  }

  const latest = await getLatestChartNumberOne(country);
  if (!latest) return null;
  return { hit: latest, usedLatestFallback: true };
}

/** Best-effort iTunes match for preview URL (may return null). */
export async function findItunesPreview(
  title: string,
  artist: string,
  country = "us",
): Promise<string | null> {
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
      next: { revalidate: 0 },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      results?: Array<{
        trackName?: string;
        artistName?: string;
        previewUrl?: string;
        kind?: string;
      }>;
    };
    const first = (data.results ?? []).find(
      (item) =>
        item.kind === "song" &&
        item.trackName?.trim() &&
        item.artistName?.trim() &&
        item.previewUrl,
    );
    return normalizePreviewUrl(first?.previewUrl ?? null);
  } catch {
    return null;
  }
}
