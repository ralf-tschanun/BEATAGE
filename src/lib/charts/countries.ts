/** Countries with historical #1 singles stored in chart_entries. */
export type StoredChartCountry = "DE" | "AT" | "GB";

/** Chart market codes used by lookups / contest config. */
export type ChartCountry = "US" | StoredChartCountry;

/** Markets offered in Birthday Song Contest settings UI. */
/** Order shown in Birthday Song Contest setup. */
export const CONTEST_CHART_COUNTRIES = [
  "AT",
  "DE",
  "GB",
  "US",
] as const satisfies readonly ChartCountry[];

export function parseChartCountry(value: string | null | undefined): ChartCountry {
  if (value === "DE" || value === "AT" || value === "GB" || value === "US") {
    return value;
  }
  return "US";
}

export const CHART_COUNTRY_OPTIONS: Record<
  ChartCountry,
  {
    label: string;
    description: string;
    /** Earliest birthday the UI should accept (includes fallback coverage). */
    availableFrom: string;
    /** When this market's own chart data starts (if later than availableFrom). */
    nativeAvailableFrom?: string;
    /** Used when this market has no #1 for a date. */
    fallbackCountry?: ChartCountry;
  }
> = {
  AT: {
    label: "Austria (Singles #1)",
    description:
      "Austrian singles #1 from 1989. Earlier dates (and any AT gaps) fall back to German charts.",
    availableFrom: "1954-03-01",
    nativeAvailableFrom: "1989-01-01",
    fallbackCountry: "DE",
  },
  DE: {
    label: "Germany (Singles #1)",
    description: "Official German singles #1 history (from Mar 1954).",
    availableFrom: "1954-03-01",
  },
  GB: {
    label: "UK (Singles #1)",
    description: "UK singles #1 history (from Nov 1952).",
    availableFrom: "1952-11-14",
  },
  US: {
    label: "US (Billboard Hot 100)",
    description: "Weekly #1 from Billboard Hot 100 (from Aug 1958).",
    availableFrom: "1958-08-04",
  },
};
