import { listCategoryMembers, fetchWikiPage } from "./mediawiki";
import {
  cleanWikiText,
  extractWikitables,
  mergeWeeklyHits,
  monthSpanToRange,
  parseDtsMonthYear,
  parseIssueDateSongArtistTables,
  parseWikitableRows,
  stitchChartEntries,
} from "./parsers/wikitext";
import type { ChartEntry, CountryImporter } from "./types";

const SOURCE = "wikipedia";

function yearFromTitle(title: string): number | null {
  const m = title.match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

async function importIssueDateYearPages(
  countryCode: "DE" | "AT",
  titles: string[],
): Promise<{ entries: ChartEntry[]; parseErrors: string[] }> {
  const entries: ChartEntry[] = [];
  const parseErrors: string[] = [];

  for (const title of titles) {
    const page = await fetchWikiPage(title);
    if (!page) {
      parseErrors.push(`Page not found: ${title}`);
      continue;
    }
    if (/^#REDIRECT/i.test(page.wikitext.trim())) {
      continue;
    }

    const year = yearFromTitle(page.title);
    const { hits, errors } = parseIssueDateSongArtistTables(
      page.wikitext,
      year ?? undefined,
    );
    parseErrors.push(...errors.map((e) => `${page.title}: ${e}`));

    if (hits.length === 0) {
      parseErrors.push(`${page.title}: no Issue date / Song / Artist rows parsed`);
      continue;
    }

    for (const range of mergeWeeklyHits(hits)) {
      entries.push({
        countryCode,
        chartType: "singles",
        position: 1,
        validFrom: range.validFrom,
        validTo: range.validTo,
        chartFrequency: "weekly",
        artist: range.artist,
        title: range.title,
        source: SOURCE,
        sourceUrl: page.url,
        sourceRevision: String(page.revisionId),
        isInterpolated: false,
        metadata: { wikipediaTitle: page.title },
      });
    }
  }

  return { entries, parseErrors };
}

/** Monthly Automatenmarkt section from the German 1950s overview page. */
async function importGermanMonthly1950s(): Promise<{
  entries: ChartEntry[];
  parseErrors: string[];
}> {
  const entries: ChartEntry[] = [];
  const parseErrors: string[] = [];
  const page = await fetchWikiPage(
    "List of German singles chart number ones of the 1950s",
  );
  if (!page) {
    return { entries, parseErrors: ["German 1950s overview page missing"] };
  }

  for (const table of extractWikitables(page.wikitext)) {
    const header = table.slice(0, 500).toLowerCase();
    if (!header.includes("tracking month")) continue;

    const rows = parseWikitableRows(table);
    for (const cells of rows) {
      if (cells.length < 4) continue;
      const monthCell = cells.find(
        (c) => /\{\{\s*dts\b/i.test(c) && /format\s*=\s*my/i.test(c),
      );
      if (!monthCell) continue;
      const parsed = parseDtsMonthYear(monthCell);
      if (!parsed) {
        parseErrors.push(`DE monthly: bad month cell ${monthCell.slice(0, 60)}`);
        continue;
      }

      const artist = cleanWikiText(cells[1] ?? "");
      const title = cleanWikiText(cells[2] ?? "");
      if (!artist || !title) {
        parseErrors.push(`DE monthly: missing artist/title near ${monthCell}`);
        continue;
      }

      const monthsAtOne = Number(cleanWikiText(cells[cells.length - 1] ?? "1")) || 1;
      const range = monthSpanToRange(parsed.year, parsed.month, monthsAtOne);

      // Automatenmarkt monthly only — Musikmarkt weekly starts mid-1959
      if (range.validFrom >= "1959-06-01") continue;

      entries.push({
        countryCode: "DE",
        chartType: "singles",
        position: 1,
        validFrom: range.validFrom,
        validTo: range.validTo,
        chartFrequency: "monthly",
        artist,
        title,
        source: SOURCE,
        sourceUrl: page.url,
        sourceRevision: String(page.revisionId),
        isInterpolated: false,
        metadata: {
          wikipediaTitle: page.title,
          chartPublisher: "Der Automatenmarkt",
        },
      });
    }
  }

  if (entries.length === 0) {
    parseErrors.push("DE monthly: no Automatenmarkt rows parsed");
  }

  return { entries, parseErrors };
}

export const importGermany: CountryImporter = {
  countryCode: "DE",
  async fetchEntries() {
    const parseErrors: string[] = [];
    const monthly = await importGermanMonthly1950s();
    parseErrors.push(...monthly.parseErrors);

    const categoryTitles = await listCategoryMembers(
      "Category:Lists of number-one songs in Germany",
    );
    const yearTitles = categoryTitles.filter((title) =>
      /^List of number-one hits of \d{4} \(Germany\)$/i.test(title),
    );

    const weekly = await importIssueDateYearPages("DE", yearTitles);
    parseErrors.push(...weekly.parseErrors);

    const entries = stitchChartEntries([
      ...monthly.entries,
      ...weekly.entries,
    ]);

    return {
      entries,
      parseErrors,
    };
  },
};
