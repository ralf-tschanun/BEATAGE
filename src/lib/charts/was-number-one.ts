import type { SupabaseClient } from "@supabase/supabase-js";
import type { StoredChartCountry } from "@/lib/charts/countries";
import { stripRecordingVersionLabel } from "@/lib/original-release-year";

function escapeIlike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function normalizeChartText(value: string): string {
  return stripRecordingVersionLabel(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(feat\.?|ft\.?|featuring)\b.*$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingThe(value: string): string {
  return value.replace(/^the\s+/, "");
}

function primaryArtistKey(artist: string): string {
  const first = artist.split(/[,&]|\/|\b(?:and|x|vs\.?)\b/i)[0] ?? artist;
  return stripLeadingThe(normalizeChartText(first));
}

function titlesMatch(a: string, b: string): boolean {
  const left = stripLeadingThe(a);
  const right = stripLeadingThe(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 4 && right.includes(left)) return true;
  if (right.length >= 4 && left.includes(right)) return true;
  return false;
}

function artistsMatch(queryArtist: string, chartArtist: string): boolean {
  if (!queryArtist) return true;
  const chart = stripLeadingThe(normalizeChartText(chartArtist));
  if (!chart) return false;
  if (queryArtist === chart) return true;
  if (queryArtist.length >= 3 && chart.includes(queryArtist)) return true;
  if (chart.length >= 3 && queryArtist.includes(chart)) return true;
  return false;
}

function expandCountries(codes: string[]): StoredChartCountry[] {
  const set = new Set<StoredChartCountry>();
  for (const code of codes) {
    if (code === "DE" || code === "AT" || code === "GB") set.add(code);
    // Austria gaps fall back to German singles charts.
    if (code === "AT") set.add("DE");
  }
  return [...set];
}

/**
 * True when this title/artist appears as a singles #1 in the selected markets.
 * Best-effort match against chart_entries (DE / AT / GB).
 */
export async function songWasSinglesNumberOne(opts: {
  supabase: SupabaseClient;
  title: string;
  artist: string | null;
  countryCodes: string[];
}): Promise<boolean> {
  const titleKey = stripLeadingThe(normalizeChartText(opts.title));
  const artistKey = opts.artist ? primaryArtistKey(opts.artist) : "";
  if (titleKey.length < 2) return false;

  const countries = expandCountries(opts.countryCodes);
  if (countries.length === 0) return false;

  // Prefer a distinctive title fragment for ILIKE (avoid very short matches).
  const fragment =
    titleKey.length >= 6
      ? titleKey.slice(0, Math.min(24, titleKey.length))
      : titleKey;

  const { data, error } = await opts.supabase
    .from("chart_entries")
    .select("artist, title, country_code")
    .eq("chart_type", "singles")
    .eq("position", 1)
    .in("country_code", countries)
    .ilike("title", `%${escapeIlike(fragment)}%`)
    .limit(80);

  if (error || !data?.length) return false;

  for (const row of data as Array<{ artist: string; title: string }>) {
    const chartTitle = normalizeChartText(row.title ?? "");
    if (!titlesMatch(titleKey, chartTitle)) continue;
    if (artistsMatch(artistKey, row.artist ?? "")) return true;
  }

  return false;
}
