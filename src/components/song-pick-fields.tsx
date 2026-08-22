"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SongPreviewPlayer } from "@/components/song-preview-player";
import type { ItunesTrackResult } from "@/lib/music";

export type SongPickValue = {
  title: string;
  artist: string;
  previewUrl: string;
};

type SongPickFieldsProps = {
  value: SongPickValue;
  onChange: (value: SongPickValue) => void;
  idPrefix?: string;
  /** e.g. "Search song 3" when nominating the 3rd song. */
  searchLabel?: string;
  /** Shown under the search/preview fields (e.g. plan limits). */
  helperText?: string;
  /**
   * Compact wizard mode: hide Title/Artist inputs and clear-preview;
   * selected track stays in the search field as “Title — Artist”.
   */
  compact?: boolean;
  /** When false, hide the preview player (contest songLinks = none). */
  showPreview?: boolean;
};

export function SongPickFields({
  value,
  onChange,
  idPrefix = "song",
  searchLabel = "Search song",
  helperText,
  compact = false,
  showPreview = true,
}: SongPickFieldsProps) {
  const [query, setQuery] = useState(
    value.title && value.artist ? `${value.title} — ${value.artist}` : "",
  );
  const [results, setResults] = useState<ItunesTrackResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [picked, setPicked] = useState(Boolean(value.previewUrl));
  const abortRef = useRef<AbortController | null>(null);
  const skipSearchRef = useRef(false);

  // Parent cleared the pick (e.g. after successful nominate) — reset search UI too.
  useEffect(() => {
    if (value.title || value.artist || value.previewUrl) return;
    skipSearchRef.current = true;
    setQuery("");
    setResults([]);
    setPicked(false);
    setSearching(false);
    setSearchError(null);
  }, [value.title, value.artist, value.previewUrl]);

  // Keep compact query in sync when parent already has title+artist.
  useEffect(() => {
    if (!compact) return;
    if (value.title && value.artist) {
      const label = `${value.title} — ${value.artist}`;
      setQuery(label);
      setPicked(Boolean(value.previewUrl) || Boolean(value.title && value.artist));
    }
  }, [compact, value.title, value.artist, value.previewUrl]);

  useEffect(() => {
    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      return;
    }

    const term = query.trim();
    if (term.length < 2 || picked) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }

    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setSearching(true);
      setSearchError(null);

      try {
        const response = await fetch(
          `/api/music/search?q=${encodeURIComponent(term)}&country=de`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as {
          results?: ItunesTrackResult[];
          error?: string;
        };
        if (!response.ok) {
          setResults([]);
          setSearchError(data.error ?? "Music search failed.");
          return;
        }
        setResults(data.results ?? []);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResults([]);
        setSearchError("Music search failed.");
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [query, picked]);

  function selectTrack(track: ItunesTrackResult) {
    skipSearchRef.current = true;
    const next = {
      title: track.trackName,
      artist: track.artistName,
      previewUrl: track.previewUrl ?? "",
    };
    onChange(next);
    setQuery(`${track.trackName} — ${track.artistName}`);
    setResults([]);
    setPicked(true);
  }

  function clearPreview() {
    onChange({ ...value, previewUrl: "" });
    setPicked(false);
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-4"}>
      <div className="space-y-2">
        {searchLabel ? (
          <Label htmlFor={`${idPrefix}-search`}>{searchLabel}</Label>
        ) : null}
        <Input
          id={`${idPrefix}-search`}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPicked(false);
            onChange({ title: "", artist: "", previewUrl: "" });
          }}
          placeholder="Type a song or artist…"
          autoComplete="off"
          maxLength={120}
        />
        {!compact ? (
          <p className="text-xs text-muted-foreground">
            Results from the iTunes catalog. Pick a match, then listen before saving.
          </p>
        ) : null}
      </div>

      {searching ? (
        <p className="text-xs text-muted-foreground">Searching…</p>
      ) : null}
      {searchError ? (
        <p className="text-sm text-destructive" role="alert">
          {searchError}
        </p>
      ) : null}

      {results.length > 0 && !picked ? (
        <ul className="max-h-56 overflow-y-auto rounded-lg border">
          {results.map((track) => (
            <li key={track.trackId} className="border-b last:border-b-0">
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted"
                onClick={() => selectTrack(track)}
              >
                {track.artworkUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={track.artworkUrl}
                    alt=""
                    className="size-10 rounded object-cover"
                  />
                ) : (
                  <div className="bg-muted size-10 rounded" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {track.trackName}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {track.artistName}
                    {track.collectionName ? ` · ${track.collectionName}` : ""}
                    {!track.previewUrl ? " · no preview" : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {!compact ? (
        <>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-title`}>Title</Label>
            <Input
              id={`${idPrefix}-title`}
              value={value.title}
              onChange={(event) => {
                setPicked(false);
                onChange({
                  title: event.target.value,
                  artist: value.artist,
                  previewUrl: "",
                });
              }}
              placeholder="Song title"
              required
              maxLength={120}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-artist`}>Artist</Label>
            <Input
              id={`${idPrefix}-artist`}
              value={value.artist}
              onChange={(event) => {
                setPicked(false);
                onChange({
                  title: value.title,
                  artist: event.target.value,
                  previewUrl: "",
                });
              }}
              placeholder="Artist"
              required
              maxLength={120}
            />
          </div>
        </>
      ) : null}

      {showPreview && value.previewUrl ? (
        <div className="space-y-1">
          <SongPreviewPlayer
            previewUrl={value.previewUrl}
            label={compact ? "" : "Listen before you save"}
          />
          {!compact ? (
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={clearPreview}
            >
              Clear preview
            </button>
          ) : null}
        </div>
      ) : null}
      {helperText ? (
        <p className="text-xs text-muted-foreground">{helperText}</p>
      ) : null}
    </div>
  );
}
