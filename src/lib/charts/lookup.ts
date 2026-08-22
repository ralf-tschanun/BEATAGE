import { createClient } from "@/lib/supabase/server";
import type { StoredChartCountry } from "@/lib/charts/countries";

export type { StoredChartCountry };

export type ChartEntryRecord = {
  id: string;
  countryCode: StoredChartCountry;
  chartType: string;
  position: number;
  validFrom: string;
  validTo: string;
  chartFrequency: string;
  artist: string;
  title: string;
  source: string;
  sourceUrl: string | null;
  sourceRevision: string | null;
  isInterpolated: boolean;
  metadata: Record<string, unknown>;
};

/**
 * Which song was #1 on a given date for a stored chart market.
 * Independent of contest UI — queries Supabase chart_entries.
 */
export async function getNumberOneSong(
  countryCode: StoredChartCountry,
  date: string,
): Promise<ChartEntryRecord | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chart_entries")
    .select(
      `
      id,
      country_code,
      chart_type,
      position,
      valid_from,
      valid_to,
      chart_frequency,
      artist,
      title,
      source,
      source_url,
      source_revision,
      is_interpolated,
      metadata
    `,
    )
    .eq("country_code", countryCode)
    .eq("chart_type", "singles")
    .eq("position", 1)
    .lte("valid_from", date)
    .gte("valid_to", date)
    .order("valid_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id as string,
    countryCode: data.country_code as StoredChartCountry,
    chartType: data.chart_type as string,
    position: Number(data.position),
    validFrom: data.valid_from as string,
    validTo: data.valid_to as string,
    chartFrequency: data.chart_frequency as string,
    artist: data.artist as string,
    title: data.title as string,
    source: data.source as string,
    sourceUrl: (data.source_url as string | null) ?? null,
    sourceRevision: (data.source_revision as string | null) ?? null,
    isInterpolated: Boolean(data.is_interpolated),
    metadata: (data.metadata as Record<string, unknown>) ?? {},
  };
}

/** Most recent #1 entry for a stored chart market (current / latest available). */
export async function getLatestNumberOneSong(
  countryCode: StoredChartCountry,
): Promise<ChartEntryRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chart_entries")
    .select(
      `
      id,
      country_code,
      chart_type,
      position,
      valid_from,
      valid_to,
      chart_frequency,
      artist,
      title,
      source,
      source_url,
      source_revision,
      is_interpolated,
      metadata
    `,
    )
    .eq("country_code", countryCode)
    .eq("chart_type", "singles")
    .eq("position", 1)
    .order("valid_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id as string,
    countryCode: data.country_code as StoredChartCountry,
    chartType: data.chart_type as string,
    position: Number(data.position),
    validFrom: data.valid_from as string,
    validTo: data.valid_to as string,
    chartFrequency: data.chart_frequency as string,
    artist: data.artist as string,
    title: data.title as string,
    source: data.source as string,
    sourceUrl: (data.source_url as string | null) ?? null,
    sourceRevision: (data.source_revision as string | null) ?? null,
    isInterpolated: Boolean(data.is_interpolated),
    metadata: (data.metadata as Record<string, unknown>) ?? {},
  };
}
