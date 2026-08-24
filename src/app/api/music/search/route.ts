import { NextResponse } from "next/server";
import {
  normalizePreviewUrl,
  parseItunesReleaseYear,
  type ItunesTrackResult,
} from "@/lib/music";

type ItunesApiResult = {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl60?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  releaseDate?: string;
  kind?: string;
};

type ItunesApiResponse = {
  results?: ItunesApiResult[];
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const term = searchParams.get("q")?.trim() ?? "";
  const country = (searchParams.get("country") ?? "de").trim() || "de";

  if (term.length < 2) {
    return NextResponse.json({ results: [] as ItunesTrackResult[] });
  }

  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", term);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", "8");
  url.searchParams.set("country", country);

  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Music search failed.", results: [] as ItunesTrackResult[] },
        { status: 502 },
      );
    }

    const data = (await response.json()) as ItunesApiResponse;
    const results: ItunesTrackResult[] = (data.results ?? [])
      .filter(
        (item) =>
          item.kind === "song" &&
          typeof item.trackId === "number" &&
          Boolean(item.trackName?.trim()) &&
          Boolean(item.artistName?.trim()),
      )
      .map((item) => ({
        trackId: item.trackId as number,
        trackName: (item.trackName as string).trim(),
        artistName: (item.artistName as string).trim(),
        collectionName: item.collectionName?.trim() || null,
        artworkUrl: item.artworkUrl100 || item.artworkUrl60 || null,
        previewUrl: normalizePreviewUrl(item.previewUrl),
        releaseYear: parseItunesReleaseYear(item.releaseDate),
      }));

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json(
      { error: "Music search failed.", results: [] as ItunesTrackResult[] },
      { status: 502 },
    );
  }
}
