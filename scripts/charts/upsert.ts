import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type { ChartEntry, ImportStats } from "./types";
import { isIsoDate } from "./types";

export type DbChartRow = {
  country_code: string;
  chart_type: string;
  position: number;
  valid_from: string;
  valid_to: string;
  chart_frequency: string;
  artist: string;
  title: string;
  source: string;
  source_url: string | null;
  source_revision: string | null;
  is_interpolated: boolean;
  metadata: Record<string, unknown>;
  updated_at: string;
};

export function createServiceSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (needed for chart import).",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function songFingerprint(artist: string, title: string): string {
  return createHash("md5")
    .update(`${artist.trim().toLowerCase()}\x1f${title.trim().toLowerCase()}`)
    .digest("hex");
}

export function toDbRow(entry: ChartEntry): DbChartRow {
  return {
    country_code: entry.countryCode,
    chart_type: entry.chartType,
    position: entry.position,
    valid_from: entry.validFrom,
    valid_to: entry.validTo,
    chart_frequency: entry.chartFrequency,
    artist: entry.artist.trim(),
    title: entry.title.trim(),
    source: entry.source,
    source_url: entry.sourceUrl ?? null,
    source_revision: entry.sourceRevision ?? null,
    is_interpolated: entry.isInterpolated,
    metadata: entry.metadata ?? {},
    updated_at: new Date().toISOString(),
  };
}

export function validateEntry(entry: ChartEntry): string | null {
  if (!entry.artist.trim() || !entry.title.trim()) return "empty artist/title";
  if (!isIsoDate(entry.validFrom) || !isIsoDate(entry.validTo)) return "bad dates";
  if (entry.validTo < entry.validFrom) return "valid_to < valid_from";
  if (entry.position < 1) return "bad position";
  return null;
}

/**
 * Upsert by natural key (country, type, position, valid_from, artist+title).
 * Detects insert vs update by probing existing rows in batches.
 */
export async function upsertChartEntries(
  supabase: SupabaseClient,
  entries: ChartEntry[],
): Promise<ImportStats> {
  const stats: ImportStats = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    parseErrors: [],
  };

  const valid: ChartEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const err = validateEntry(entry);
    if (err) {
      stats.parseErrors.push(
        `Skip invalid (${err}): ${entry.countryCode} ${entry.validFrom} ${entry.title}`,
      );
      stats.skipped += 1;
      continue;
    }
    const key = [
      entry.countryCode,
      entry.chartType,
      entry.position,
      entry.validFrom,
      songFingerprint(entry.artist, entry.title),
    ].join("|");
    if (seen.has(key)) {
      stats.skipped += 1;
      continue;
    }
    seen.add(key);
    valid.push(entry);
  }

  const BATCH = 100;
  for (let i = 0; i < valid.length; i += BATCH) {
    const batch = valid.slice(i, i + BATCH);
    const rows = batch.map(toDbRow);

    // Count existing matches for insert/update stats
    for (const row of rows) {
      const { data: existing, error: selectError } = await supabase
        .from("chart_entries")
        .select("id, valid_to, source_revision, artist, title")
        .eq("country_code", row.country_code)
        .eq("chart_type", row.chart_type)
        .eq("position", row.position)
        .eq("valid_from", row.valid_from)
        .eq("artist", row.artist)
        .eq("title", row.title)
        .maybeSingle();

      if (selectError) {
        stats.parseErrors.push(`Select failed: ${selectError.message}`);
        stats.skipped += 1;
        continue;
      }

      if (!existing) {
        const { error } = await supabase.from("chart_entries").insert(row);
        if (error) {
          // Unique index may collide on md5 vs exact artist/title casing — try upsert path
          if (error.code === "23505") {
            stats.skipped += 1;
            stats.parseErrors.push(
              `Unique conflict insert: ${row.country_code} ${row.valid_from} ${row.title}`,
            );
          } else {
            stats.parseErrors.push(`Insert failed: ${error.message}`);
            stats.skipped += 1;
          }
        } else {
          stats.inserted += 1;
        }
        continue;
      }

      const unchanged =
        existing.valid_to === row.valid_to &&
        existing.source_revision === row.source_revision;
      if (unchanged) {
        stats.skipped += 1;
        continue;
      }

      const { error } = await supabase
        .from("chart_entries")
        .update({
          valid_to: row.valid_to,
          chart_frequency: row.chart_frequency,
          source: row.source,
          source_url: row.source_url,
          source_revision: row.source_revision,
          is_interpolated: row.is_interpolated,
          metadata: row.metadata,
          updated_at: row.updated_at,
        })
        .eq("id", existing.id);

      if (error) {
        stats.parseErrors.push(`Update failed: ${error.message}`);
        stats.skipped += 1;
      } else {
        stats.updated += 1;
      }
    }
  }

  return stats;
}
