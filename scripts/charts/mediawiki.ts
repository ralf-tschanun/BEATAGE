/** MediaWiki Action API helpers (English Wikipedia). */

const API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT =
  "MyContestChartImporter/0.1 (https://github.com/local; historical #1 chart import)";

export type WikiPage = {
  title: string;
  pageId: number;
  revisionId: number;
  wikitext: string;
  url: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiGet(params: Record<string, string>): Promise<unknown> {
  const url = new URL(API);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await sleep(800 * attempt);
    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });
    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`Wikipedia API ${response.status}`);
      continue;
    }
    if (!response.ok) {
      throw new Error(`Wikipedia API ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }
  throw lastError instanceof Error ? lastError : new Error("Wikipedia API failed");
}

export async function fetchWikiPage(title: string): Promise<WikiPage | null> {
  const data = (await apiGet({
    action: "query",
    titles: title,
    prop: "revisions|info",
    rvprop: "content|ids",
    rvslots: "main",
    inprop: "url",
    redirects: "1",
  })) as {
    query?: {
      pages?: Array<{
        missing?: boolean;
        title?: string;
        pageid?: number;
        fullurl?: string;
        revisions?: Array<{
          revid?: number;
          slots?: { main?: { content?: string } };
        }>;
      }>;
    };
  };

  const page = data.query?.pages?.[0];
  if (!page || page.missing || !page.title || !page.pageid) return null;
  const revision = page.revisions?.[0];
  const wikitext = revision?.slots?.main?.content;
  if (!wikitext || !revision?.revid) return null;

  return {
    title: page.title,
    pageId: page.pageid,
    revisionId: revision.revid,
    wikitext,
    url: page.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
  };
}

export async function listCategoryMembers(
  categoryTitle: string,
  limit = 500,
): Promise<string[]> {
  const titles: string[] = [];
  let continueToken: string | undefined;

  do {
    const params: Record<string, string> = {
      action: "query",
      list: "categorymembers",
      cmtitle: categoryTitle,
      cmlimit: "50",
      cmtype: "page",
    };
    if (continueToken) params.cmcontinue = continueToken;

    const data = (await apiGet(params)) as {
      continue?: { cmcontinue?: string };
      query?: { categorymembers?: Array<{ title?: string }>; };
    };

    for (const member of data.query?.categorymembers ?? []) {
      if (member.title) titles.push(member.title);
    }
    continueToken = data.continue?.cmcontinue;
    if (titles.length >= limit) break;
    await sleep(250);
  } while (continueToken);

  return titles.slice(0, limit);
}
