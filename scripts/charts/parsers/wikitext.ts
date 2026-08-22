/** Wikitext cleaning + table parsing helpers. */

import { addDaysIso, firstDayOfMonthIso, lastDayOfMonthIso } from "../types";

export function cleanWikiText(raw: string): string {
  let text = raw;

  // {{sortname|First|Last}} / {{sortname|First|Last|nolink=1}}
  text = text.replace(
    /\{\{\s*sortname\s*\|\s*([^|{}]+)\s*\|\s*([^|{}]+?)(?:\|[^}]*)?\}\}/gi,
    (_m, first: string, last: string) => `${first.trim()} ${last.trim()}`,
  );

  // {{sort|key|visible}}
  text = text.replace(/\{\{\s*sort\s*\|[^|]*\|([^}]*)\}\}/gi, "$1");

  // {{ill|Name|de}} / {{ill|Name|de|quote=y}}
  text = text.replace(/\{\{\s*ill\s*\|\s*([^|{}]+?)(?:\|[^}]*)?\}\}/gi, "$1");

  // {{dts|...}} leave for dedicated parsers; strip other simple templates to inner text
  text = text.replace(/\{\{[^{}]*\}\}/g, (tpl) => {
    if (/^\{\{\s*dts\b/i.test(tpl)) return tpl;
    if (/^\{\{\s*dagger/i.test(tpl)) return "";
    return "";
  });

  // [[Link|Label]] or [[Link]]
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  text = text.replace(/\[\[([^\]]+)\]\]/g, "$1");

  // HTML / refs / bold
  text = text.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, "");
  text = text.replace(/<ref\b[^>]*\/>/gi, "");
  text = text.replace(/<\/?[^>]+>/g, "");
  text = text.replace(/'{2,}/g, "");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/\s+/g, " ").trim();

  // Drop trailing † markers etc.
  text = text.replace(/[†‡*]+$/g, "").trim();
  return text;
}

export function parseDtsToIso(cell: string): string | null {
  const raw = cell.trim();

  // {{dts|format=dmy|YYYY|M|D}} or {{dts|YYYY|M|D}}
  let m = raw.match(
    /\{\{\s*dts\b[^}]*\|\s*(?:format\s*=\s*dmy\s*\|)?\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})\s*\}\}/i,
  );
  if (m) {
    return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  }

  // {{dts|format=my|YYYY|M}}
  m = raw.match(
    /\{\{\s*dts\b[^}]*\|\s*format\s*=\s*my\s*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\}\}/i,
  );
  if (m) {
    return firstDayOfMonthIso(Number(m[1]), Number(m[2]));
  }

  // {{dts|3 December 1976}} or {{dts|December 3, 1976}}
  m = raw.match(
    /\{\{\s*dts\s*\|\s*(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\s*\}\}/i,
  );
  if (m) {
    const month = monthNameToNumber(m[2]!);
    if (!month) return null;
    return `${m[3]}-${String(month).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }

  m = raw.match(
    /\{\{\s*dts\s*\|\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})\s*\}\}/i,
  );
  if (m) {
    const month = monthNameToNumber(m[1]!);
    if (!month) return null;
    return `${m[3]}-${String(month).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  }

  // Plain "3 January 2020"
  m = raw.match(
    /^(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i,
  );
  if (m) {
    const month = monthNameToNumber(m[2]!);
    if (!month) return null;
    return `${m[3]}-${String(month).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }

  return null;
}

export function parseDtsMonthYear(cell: string): { year: number; month: number } | null {
  const m = cell.match(
    /\{\{\s*dts\b[^}]*\|\s*format\s*=\s*my\s*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\}\}/i,
  );
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) };
}

function monthNameToNumber(name: string): number | null {
  const key = name.toLowerCase();
  const map: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };
  return map[key] ?? null;
}

/**
 * Parse an Issue-date cell from DE/AT weekly charts.
 * Supports {{dts}}, hidden sort spans, plain "4 January", and year hints.
 */
export function parseIssueDateCell(
  cell: string,
  yearHint?: number,
): string | null {
  const raw = cell.trim();

  // <span style="display:none">2008-01-04</span> 4 January
  let m = raw.match(
    /<span[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*<\/span>/i,
  );
  if (m) return m[1]!;

  // data-sort-value="2008-01-04" or similar
  m = raw.match(/data-sort-value\s*=\s*"(\d{4}-\d{2}-\d{2})"/i);
  if (m) return m[1]!;

  const fromDts = parseDtsToIso(raw);
  if (fromDts) return fromDts;

  const cleaned = cleanWikiText(raw);

  // Leading ISO left after stripping tags: "2008-01-04 4 January"
  m = cleaned.match(/^(\d{4}-\d{2}-\d{2})\b/);
  if (m) return m[1]!;

  // "4 January 2008"
  m = cleaned.match(
    /^(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i,
  );
  if (m) {
    const month = monthNameToNumber(m[2]!);
    if (!month) return null;
    return `${m[3]}-${String(month).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }

  // "4 January" + yearHint
  m = cleaned.match(
    /^(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)$/i,
  );
  if (m && yearHint) {
    const month = monthNameToNumber(m[2]!);
    if (!month) return null;
    return `${yearHint}-${String(month).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }

  return null;
}

export type WikiTableRow = {
  cells: string[];
  /** Rowspan values declared on this row (index → rowspan). */
  rowspans: Array<number | null>;
};

/** Extract wikitable blocks from wikitext. */
export function extractWikitables(wikitext: string): string[] {
  const tables: string[] = [];
  const re = /\{\|[\s\S]*?\n\|\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(wikitext))) {
    tables.push(match[0]);
  }
  return tables;
}

/**
 * Parse a wikitable into rows of cells, expanding rowspan vertically.
 * Handles |- separated rows and || / | cell separators.
 */
export function parseWikitableRows(tableWikitext: string): string[][] {
  const lines = tableWikitext.split("\n");
  const rawRows: Array<{ cells: string[]; rowspans: number[] }> = [];
  let current: { cells: string[]; rowspans: number[] } | null = null;

  const flush = () => {
    if (current && current.cells.length > 0) rawRows.push(current);
    current = null;
  };

  const pushCell = (cellRaw: string) => {
    if (!current) current = { cells: [], rowspans: [] };
    const rowspanMatch = cellRaw.match(/rowspan\s*=\s*"?(\d+)"?/i);
    const rowspan = rowspanMatch ? Number(rowspanMatch[1]) : 1;
    // Strip attributes before content: `scope=row| text` or `align=center|text`
    let content = cellRaw;
    const pipe = content.indexOf("|");
    if (pipe >= 0 && !content.slice(0, pipe).includes("[[") && !content.slice(0, pipe).includes("{{")) {
      const left = content.slice(0, pipe);
      if (/[=:]/.test(left) || /^(?:!|\s*$)/.test(left)) {
        content = content.slice(pipe + 1);
      }
    }
    content = content.replace(/^!+/, "").trim();
    current.cells.push(content);
    current.rowspans.push(rowspan);
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("{|") || trimmed.startsWith("|+") || trimmed.startsWith("|}") || trimmed.startsWith("|-")) {
      if (trimmed.startsWith("|-")) flush();
      continue;
    }

    if (trimmed.startsWith("!") || trimmed.startsWith("|")) {
      // Header or data row — may contain || separators
      const body = trimmed.replace(/^\!+/, "|");
      if (body.includes("||")) {
        flush();
        current = { cells: [], rowspans: [] };
        const parts = body.replace(/^\|/, "").split("||");
        for (const part of parts) pushCell(part);
        flush();
      } else {
        // Single cell on this line (continuation rowspan style)
        if (!current) current = { cells: [], rowspans: [] };
        pushCell(body.replace(/^\|/, ""));
      }
    }
  }
  flush();

  // Expand rowspans into a dense grid
  const active: Array<{ value: string; remaining: number } | null> = [];
  const result: string[][] = [];

  for (const row of rawRows) {
    // Skip pure section header rows (colspan-only year anchors)
    const joined = row.cells.join(" ").toLowerCase();
    if (/colspan/i.test(row.cells.join("|")) && row.cells.length <= 2) {
      continue;
    }
    if (/^\{\{anchor/i.test(joined) && row.cells.length <= 2) {
      continue;
    }

    const out: string[] = [];
    let src = 0;
    let col = 0;
    while (src < row.cells.length || active.some((a) => a && a.remaining > 0)) {
      while (active.length <= col) active.push(null);
      if (active[col] && active[col]!.remaining > 0) {
        out.push(active[col]!.value);
        active[col]!.remaining -= 1;
        if (active[col]!.remaining === 0) active[col] = null;
        col += 1;
        continue;
      }
      if (src >= row.cells.length) break;
      const value = row.cells[src]!;
      const span = row.rowspans[src] ?? 1;
      // Skip colspan-heavy year headers
      if (/colspan\s*=/i.test(value) && !parseDtsToIso(value) && cleanWikiText(value).length < 8) {
        src += 1;
        continue;
      }
      out.push(value);
      if (span > 1) {
        active[col] = { value, remaining: span - 1 };
      }
      src += 1;
      col += 1;
    }
    if (out.length >= 2) result.push(out);
  }

  return result;
}

export type IssueDateHit = {
  issueDate: string;
  title: string;
  artist: string;
};

/**
 * Detect Issue date | Song | Artist style tables (DE/AT weekly).
 * Extra columns after artist are ignored.
 */
export function parseIssueDateSongArtistTables(
  wikitext: string,
  yearHint?: number,
): { hits: IssueDateHit[]; errors: string[] } {
  const errors: string[] = [];
  const hits: IssueDateHit[] = [];

  for (const table of extractWikitables(wikitext)) {
    // Headers may span several lines (! Issue date\n! Single\n…)
    const header = table.slice(0, 1200).toLowerCase();
    if (!header.includes("issue date") && !header.includes("issue week")) {
      continue;
    }
    if (
      !header.includes("song") &&
      !header.includes("single") &&
      !header.includes("title")
    ) {
      continue;
    }

    const rows = parseWikitableRows(table);
    for (const cells of rows) {
      if (cells.length < 3) continue;

      const label = cleanWikiText(cells[0] ?? "").toLowerCase();
      if (
        label === "issue date" ||
        label === "song" ||
        label === "single" ||
        label === "artist" ||
        label === "title"
      ) {
        continue;
      }

      const dateIso = parseIssueDateCell(cells[0]!, yearHint);
      if (!dateIso) {
        errors.push(`Could not parse issue date: ${cells[0]!.slice(0, 80)}`);
        continue;
      }

      // Song/Single then Artist — skip ref-only leftovers
      let title = cleanWikiText(cells[1]!);
      let artist = cleanWikiText(cells[2]!);

      // Some rows put bgcolor/attributes; if title looks like a bare ref residue, try next cells
      if ((!title || /^https?:/i.test(title)) && cells.length > 4) {
        title = cleanWikiText(cells[1]!);
        artist = cleanWikiText(cells[2]!);
      }

      if (!title || !artist) {
        errors.push(`Missing title/artist at ${dateIso}`);
        continue;
      }
      // Album tables sometimes leak; require title not equal to a chart week label
      if (/^\d{1,2}\s+[A-Za-z]+/.test(title) && title.length < 20) {
        continue;
      }

      hits.push({ issueDate: dateIso, title, artist });
    }
  }

  return { hits, errors };
}

/** Merge consecutive weekly issue dates with the same song into ranges. */
export function mergeWeeklyHits(
  hits: IssueDateHit[],
  weekLengthDays = 7,
): Array<{ validFrom: string; validTo: string; title: string; artist: string }> {
  const sorted = [...hits].sort((a, b) => a.issueDate.localeCompare(b.issueDate));
  const merged: Array<{ validFrom: string; validTo: string; title: string; artist: string }> = [];

  for (const hit of sorted) {
    const last = merged[merged.length - 1];
    const sameSong =
      last &&
      last.title.toLowerCase() === hit.title.toLowerCase() &&
      last.artist.toLowerCase() === hit.artist.toLowerCase();

    if (sameSong) {
      // Extend through this chart week
      last!.validTo = addDaysIso(hit.issueDate, weekLengthDays - 1);
      continue;
    }

    if (last) {
      // Close previous range the day before this issue (avoid gaps/overlaps)
      const dayBefore = addDaysIso(hit.issueDate, -1);
      if (dayBefore > last.validFrom) {
        last.validTo = dayBefore;
      }
    }

    merged.push({
      validFrom: hit.issueDate,
      validTo: addDaysIso(hit.issueDate, weekLengthDays - 1),
      title: hit.title,
      artist: hit.artist,
    });
  }

  return merged;
}

/** Close small gaps between consecutive #1 ranges (e.g. year-boundary weeks). */
export function stitchChartEntries<T extends { validFrom: string; validTo: string }>(
  entries: T[],
): T[] {
  const sorted = [...entries].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i]!;
    const next = sorted[i + 1]!;
    const dayBeforeNext = addDaysIso(next.validFrom, -1);
    if (dayBeforeNext > cur.validTo) {
      // Extend current range up to the day before the next #1 starts
      cur.validTo = dayBeforeNext;
    } else if (dayBeforeNext < cur.validTo && dayBeforeNext >= cur.validFrom) {
      // Avoid overlap into the next range
      cur.validTo = dayBeforeNext;
    }
  }
  return sorted;
}

export function monthSpanToRange(
  year: number,
  month: number,
  monthsAtNumberOne: number,
): { validFrom: string; validTo: string } {
  const validFrom = firstDayOfMonthIso(year, month);
  const endMonthIndex = month - 1 + Math.max(1, monthsAtNumberOne) - 1;
  const endYear = year + Math.floor(endMonthIndex / 12);
  const endMonth = (endMonthIndex % 12) + 1;
  return { validFrom, validTo: lastDayOfMonthIso(endYear, endMonth) };
}
