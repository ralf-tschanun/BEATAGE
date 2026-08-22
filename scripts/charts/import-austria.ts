import { fetchWikiPage, listCategoryMembers } from "./mediawiki";
import {
  mergeWeeklyHits,
  parseIssueDateSongArtistTables,
  stitchChartEntries,
} from "./parsers/wikitext";
import type { ChartEntry, CountryImporter } from "./types";

const SOURCE = "wikipedia";

export const importAustria: CountryImporter = {
  countryCode: "AT",
  async fetchEntries() {
    const entries: ChartEntry[] = [];
    const parseErrors: string[] = [];

    const categoryTitles = await listCategoryMembers(
      "Category:Lists of number-one songs in Austria",
    );
    const yearTitles = categoryTitles.filter((title) =>
      /^List of number-one hits of \d{4} \(Austria\)$/i.test(title),
    );

    for (const title of yearTitles) {
      const page = await fetchWikiPage(title);
      if (!page) {
        parseErrors.push(`Page not found: ${title}`);
        continue;
      }
      if (/^#REDIRECT/i.test(page.wikitext.trim())) continue;

      const yearMatch = page.title.match(/\b(19|20)\d{2}\b/);
      const year = yearMatch ? Number(yearMatch[0]) : undefined;
      const { hits, errors } = parseIssueDateSongArtistTables(page.wikitext, year);
      parseErrors.push(...errors.map((e) => `${page.title}: ${e}`));

      if (hits.length === 0) {
        parseErrors.push(`${page.title}: no Issue date / Song / Artist rows parsed`);
        continue;
      }

      for (const range of mergeWeeklyHits(hits)) {
        entries.push({
          countryCode: "AT",
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

    return { entries: stitchChartEntries(entries), parseErrors };
  },
};
