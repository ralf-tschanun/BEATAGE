/** Shared chart import / lookup types (DE, AT, GB MVP). */

export type ChartCountryCode = "DE" | "AT" | "GB";

export type ChartFrequency = "weekly" | "biweekly" | "monthly" | string;

export type ChartEntry = {
  countryCode: ChartCountryCode;
  chartType: "singles";
  position: number;
  validFrom: string; // YYYY-MM-DD
  validTo: string; // YYYY-MM-DD
  chartFrequency: ChartFrequency;
  artist: string;
  title: string;
  source: string;
  sourceUrl?: string;
  sourceRevision?: string;
  isInterpolated: boolean;
  metadata?: Record<string, unknown>;
};

export type ImportStats = {
  inserted: number;
  updated: number;
  skipped: number;
  parseErrors: string[];
};

export type CountryImporter = {
  countryCode: ChartCountryCode;
  fetchEntries: () => Promise<{
    entries: ChartEntry[];
    parseErrors: string[];
  }>;
};

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function compareIsoDates(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Add days to an ISO date (UTC calendar arithmetic). */
export function addDaysIso(iso: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new Error(`Invalid ISO date: ${iso}`);
  }
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  if (Number.isNaN(dt.getTime())) {
    throw new Error(`Invalid ISO date: ${iso}`);
  }
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function lastDayOfMonthIso(year: number, month1to12: number): string {
  const dt = new Date(Date.UTC(year, month1to12, 0));
  return dt.toISOString().slice(0, 10);
}

export function firstDayOfMonthIso(year: number, month1to12: number): string {
  return `${year}-${String(month1to12).padStart(2, "0")}-01`;
}
