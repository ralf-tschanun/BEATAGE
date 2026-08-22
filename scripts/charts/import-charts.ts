#!/usr/bin/env npx tsx
/**
 * Import historical singles #1 charts into Supabase chart_entries.
 *
 * Usage:
 *   npm run import:charts -- --country=DE
 *   npm run import:charts -- --country=AT
 *   npm run import:charts -- --country=GB
 *   npm run import:charts -- --country=all
 *   npm run import:charts -- --country=DE --dry-run
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { importAustria } from "./import-austria";
import { importGermany } from "./import-germany";
import { importUnitedKingdom } from "./import-uk";
import type { ChartCountryCode, CountryImporter, ImportStats } from "./types";
import { createServiceSupabase, upsertChartEntries } from "./upsert";

function loadEnvFiles() {
  for (const name of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), name);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

function parseArgs(argv: string[]) {
  let country: string = "all";
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    if (arg.startsWith("--country=")) country = arg.slice("--country=".length);
  }
  return { country: country.toUpperCase(), dryRun };
}

const IMPORTERS: Record<ChartCountryCode, CountryImporter> = {
  DE: importGermany,
  AT: importAustria,
  GB: importUnitedKingdom,
};

async function runCountry(
  code: ChartCountryCode,
  dryRun: boolean,
): Promise<ImportStats> {
  console.log(`\n=== Importing ${code} ===`);
  const importer = IMPORTERS[code];
  const { entries, parseErrors } = await importer.fetchEntries();
  console.log(`Parsed ${entries.length} chart entries`);

  if (parseErrors.length > 0) {
    console.log(`Parse issues (${parseErrors.length}):`);
    for (const err of parseErrors.slice(0, 40)) {
      console.log(`  - ${err}`);
    }
    if (parseErrors.length > 40) {
      console.log(`  … ${parseErrors.length - 40} more`);
    }
  }

  if (dryRun) {
    console.log("Dry run — skipping Supabase upsert.");
    const sample = entries.slice(0, 3);
    for (const row of sample) {
      console.log(
        `  sample: ${row.validFrom}→${row.validTo} | ${row.artist} — ${row.title} (${row.chartFrequency})`,
      );
    }
    return {
      inserted: 0,
      updated: 0,
      skipped: entries.length,
      parseErrors,
    };
  }

  const supabase = createServiceSupabase();
  const stats = await upsertChartEntries(supabase, entries);
  stats.parseErrors = [...parseErrors, ...stats.parseErrors];
  console.log(
    `Done ${code}: inserted=${stats.inserted} updated=${stats.updated} skipped=${stats.skipped}`,
  );
  return stats;
}

async function main() {
  loadEnvFiles();
  const { country, dryRun } = parseArgs(process.argv.slice(2));

  const codes: ChartCountryCode[] =
    country === "ALL"
      ? (["DE", "AT", "GB"] as ChartCountryCode[])
      : country === "DE" || country === "AT" || country === "GB"
        ? [country]
        : [];

  if (codes.length === 0) {
    console.error("Use --country=DE|AT|GB|all");
    process.exit(1);
  }

  if (dryRun) console.log("Mode: dry-run");

  const totals: ImportStats = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    parseErrors: [],
  };

  for (const code of codes) {
    const stats = await runCountry(code, dryRun);
    totals.inserted += stats.inserted;
    totals.updated += stats.updated;
    totals.skipped += stats.skipped;
    totals.parseErrors.push(...stats.parseErrors);
  }

  console.log("\n=== Totals ===");
  console.log(
    `inserted=${totals.inserted} updated=${totals.updated} skipped=${totals.skipped} parseErrors=${totals.parseErrors.length}`,
  );

  if (totals.parseErrors.length > 0) {
    // Non-zero exit only if nothing was imported and not dry-run with zero entries
    process.exitCode = 0;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
