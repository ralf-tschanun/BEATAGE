import { fetchWikiPage } from "./mediawiki";
import {
  cleanWikiText,
  extractWikitables,
  parseDtsToIso,
} from "./parsers/wikitext";
import { addDaysIso, type ChartEntry, type CountryImporter } from "./types";

const SOURCE = "wikipedia";

const UK_DECADE_PAGES = [
  "List of UK singles chart number ones of the 1950s",
  "List of UK singles chart number ones of the 1960s",
  "List of UK singles chart number ones of the 1970s",
  "List of UK singles chart number ones of the 1980s",
  "List of UK singles chart number ones of the 1990s",
  "List of UK singles chart number ones of the 2000s",
  "List of UK singles chart number ones of the 2010s",
  "List of UK singles chart number ones of the 2020s",
];

/** Split a wiki table data line into cells, respecting [[links]] and {{templates}}. */
function splitWikiCells(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|") || body.startsWith("!")) body = body.slice(1);

  const cells: string[] = [];
  let current = "";
  let depthLink = 0;
  let depthTpl = 0;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    const next = body[i + 1];
    if (ch === "[" && next === "[") {
      depthLink += 1;
      current += "[[";
      i += 1;
      continue;
    }
    if (ch === "]" && next === "]" && depthLink > 0) {
      depthLink -= 1;
      current += "]]";
      i += 1;
      continue;
    }
    if (ch === "{" && next === "{") {
      depthTpl += 1;
      current += "{{";
      i += 1;
      continue;
    }
    if (ch === "}" && next === "}" && depthTpl > 0) {
      depthTpl -= 1;
      current += "}}";
      i += 1;
      continue;
    }
    if (ch === "|" && next === "|" && depthLink === 0 && depthTpl === 0) {
      cells.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    current += ch;
  }
  if (current.trim()) cells.push(current.trim());
  return cells;
}

function stripCellAttributes(part: string): string {
  // `align="center"|9` or `scope=row style="…"|{{sort|01|1}}`
  const match = part.match(
    /^(?:[\w-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s|]+)\s*)+\|([\s\S]*)$/,
  );
  return match ? match[1]!.trim() : part.trim();
}

/**
 * UK decade tables: Artist | Single | Label | Date | Weeks
 * Logical rows are separated by |- and may span multiple physical lines.
 */
function parseUkDecadeTable(
  wikitext: string,
  pageTitle: string,
): {
  entries: Array<{ validFrom: string; validTo: string; artist: string; title: string }>;
  errors: string[];
} {
  const errors: string[] = [];
  const entries: Array<{
    validFrom: string;
    validTo: string;
    artist: string;
    title: string;
  }> = [];

  for (const table of extractWikitables(wikitext)) {
    const dtsCount = (table.match(/\{\{\s*dts\b/gi) ?? []).length;
    if (dtsCount < 5) continue;
    const lower = table.toLowerCase();
    const isHistoryTable =
      lower.includes("chart history") ||
      lower.includes("week starting") ||
      lower.includes("reached number one") ||
      (lower.includes("record label") && lower.includes("weeks at"));
    if (!isHistoryTable) continue;
    // Artist milestone tables often have a "Number ones" count column.
    if (
      /!scope=col[^|]*\|number ones/i.test(table) &&
      !lower.includes("week starting") &&
      !lower.includes("reached number one") &&
      !lower.includes("chart history")
    ) {
      continue;
    }

    const rowBlocks = table.split(/\n\s*\|-/);
    for (const block of rowBlocks) {
      const lines = block
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("|") || l.startsWith("!"));

      const cells: string[] = [];
      for (const line of lines) {
        if (line.startsWith("!") && /scope\s*=\s*col/i.test(line)) continue;
        for (const part of splitWikiCells(line)) {
          cells.push(stripCellAttributes(part));
        }
      }

      if (cells.length < 3) continue;
      if (cells.some((c) => /colspan\s*=/i.test(c))) continue;

      const dateIdx = cells.findIndex((c) => /\{\{\s*dts\b/i.test(c));
      if (dateIdx < 0) continue;

      // Ignore footnote/milestone dts cells that are not chart week starts
      // (e.g. "{{dts|May 1984}}" month-only in prose tables).
      if (!/\d{1,2}/.test(cells[dateIdx]!) && !/\|\s*\d{4}\s*\|/.test(cells[dateIdx]!)) {
        continue;
      }

      const validFrom = parseDtsToIso(cells[dateIdx]!);
      if (!validFrom) {
        // Month-only dts in side tables — skip quietly
        if (/\{\{\s*dts\s*\|\s*[A-Za-z]+\s+\d{4}\s*\}\}/.test(cells[dateIdx]!)) {
          continue;
        }
        errors.push(`${pageTitle}: bad week date ${cells[dateIdx]!.slice(0, 60)}`);
        continue;
      }

      // Prefer: [No, Artist, Title, Label, Date, Weeks]
      let artist = "";
      let title = "";
      if (dateIdx >= 4) {
        artist = cleanWikiText(cells[1] ?? "");
        title = cleanWikiText(cells[2] ?? "");
      } else if (dateIdx === 3) {
        artist = cleanWikiText(cells[0] ?? "");
        title = cleanWikiText(cells[1] ?? "");
        if (/^\d+$/.test(artist)) {
          artist = cleanWikiText(cells[1] ?? "");
          title = cleanWikiText(cells[2] ?? "");
        }
      } else if (dateIdx === 2) {
        artist = cleanWikiText(cells[0] ?? "");
        title = cleanWikiText(cells[1] ?? "");
      }

      const weeksRaw = cleanWikiText(cells[dateIdx + 1] ?? "1");
      const weeksMatch = weeksRaw.match(/^(\d{1,2})\b/);
      if (!weeksMatch) {
        errors.push(`${pageTitle}: bad weeks cell at ${validFrom}: ${weeksRaw.slice(0, 40)}`);
        continue;
      }
      const weeks = Math.max(1, Number(weeksMatch[1]));
      if (weeks > 52) {
        errors.push(`${pageTitle}: implausible weeks=${weeks} at ${validFrom}`);
        continue;
      }

      if (!artist || !title) {
        errors.push(`${pageTitle}: missing artist/title at ${validFrom}`);
        continue;
      }
      if (/^(artist|single|song|record label|number)$/i.test(artist)) continue;

      let validTo: string;
      try {
        validTo = addDaysIso(validFrom, weeks * 7 - 1);
      } catch {
        errors.push(`${pageTitle}: invalid date arithmetic at ${validFrom}`);
        continue;
      }

      entries.push({
        validFrom,
        validTo,
        artist,
        title,
      });
    }
  }

  if (entries.length === 0) {
    errors.push(`${pageTitle}: no UK chart history rows parsed`);
  }

  return { entries, errors };
}

export const importUnitedKingdom: CountryImporter = {
  countryCode: "GB",
  async fetchEntries() {
    const entries: ChartEntry[] = [];
    const parseErrors: string[] = [];

    for (const title of UK_DECADE_PAGES) {
      const page = await fetchWikiPage(title);
      if (!page) {
        parseErrors.push(`Page not found: ${title}`);
        continue;
      }

      const parsed = parseUkDecadeTable(page.wikitext, page.title);
      parseErrors.push(...parsed.errors);

      for (const row of parsed.entries) {
        entries.push({
          countryCode: "GB",
          chartType: "singles",
          position: 1,
          validFrom: row.validFrom,
          validTo: row.validTo,
          chartFrequency: "weekly",
          artist: row.artist,
          title: row.title,
          source: SOURCE,
          sourceUrl: page.url,
          sourceRevision: String(page.revisionId),
          isInterpolated: false,
          metadata: { wikipediaTitle: page.title },
        });
      }
    }

    return { entries, parseErrors };
  },
};
