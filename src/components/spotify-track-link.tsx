"use client";

import { useEffect, useState, type MouseEvent } from "react";

const STORAGE_KEY = "beatage.spotify-opened";

type SpotifyTrackLinkProps = {
  /** https://open.spotify.com/track/... fallback */
  href: string;
  /** spotify:track:... when known (preferred for native app). */
  uri?: string | null;
  /** Stable id for "already opened" (e.g. contestId:candidateId). */
  openedKey?: string | null;
  className?: string;
};

function trackIdFromWebUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("spotify.com")) return null;
    const match = parsed.pathname.match(/\/track\/([a-zA-Z0-9]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function appUriFromHref(href: string, uri?: string | null): string | null {
  const trimmed = uri?.trim();
  if (trimmed?.startsWith("spotify:")) return trimmed;
  const id = trackIdFromWebUrl(href);
  return id ? `spotify:track:${id}` : null;
}

function readOpenedKeys(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((value): value is string => typeof value === "string"),
    );
  } catch {
    return new Set();
  }
}

function markOpenedKey(key: string) {
  try {
    const next = readOpenedKeys();
    next.add(key);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Prefer the native Spotify app (spotify: URI). Fall back to open.spotify.com
 * if the app does not take focus (typical when not installed).
 */
function openInSpotifyApp(webUrl: string, appUri: string | null) {
  if (!appUri) {
    window.open(webUrl, "_blank", "noopener,noreferrer");
    return;
  }

  let handedOff = false;
  const markHandedOff = () => {
    handedOff = true;
  };

  window.addEventListener("blur", markHandedOff);
  document.addEventListener("visibilitychange", markHandedOff);

  // Same-tab protocol navigation: OS hands off to the Spotify app when present.
  window.location.href = appUri;

  window.setTimeout(() => {
    window.removeEventListener("blur", markHandedOff);
    document.removeEventListener("visibilitychange", markHandedOff);
    if (handedOff || document.hidden) return;
    window.open(webUrl, "_blank", "noopener,noreferrer");
  }, 900);
}

/** Official-style Spotify mark; opens the desktop/mobile app when available. */
export function SpotifyTrackLink({
  href,
  uri = null,
  openedKey = null,
  className,
}: SpotifyTrackLinkProps) {
  const appUri = appUriFromHref(href, uri);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (!openedKey) {
      setOpened(false);
      return;
    }
    setOpened(readOpenedKeys().has(openedKey));
  }, [openedKey]);

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (openedKey) {
      markOpenedKey(openedKey);
      setOpened(true);
    }

    // Allow modified clicks (new tab / download) to use the web URL as-is.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    openInSpotifyApp(href, appUri);
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ""}`}>
      <a
        href={href}
        onClick={onClick}
        rel="noopener noreferrer"
        title={opened ? "Open in Spotify (opened before)" : "Open in Spotify"}
        aria-label={opened ? "Open in Spotify (opened before)" : "Open in Spotify"}
        className="inline-flex shrink-0 items-center justify-center rounded-full transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954]/60"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width="22"
          height="22"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="12" fill="#1DB954" />
          <path
            fill="#000"
            d="M16.9 17.2c-.2.4-.7.5-1 .2-2.8-1.7-6.3-2.1-10.4-1.1-.4.1-.9-.2-1-.6-.1-.4.2-.9.6-1 4.5-1 8.4-.6 11.5 1.3.4.2.5.7.3 1.2zm1.4-3.1c-.3.4-.8.6-1.2.3-3.2-2-8.1-2.5-11.9-1.4-.5.1-1-.2-1.2-.7-.1-.5.2-1 .7-1.2 4.3-1.3 9.7-.7 13.4 1.6.4.2.5.8.2 1.4zm.1-3.2c-3.8-2.3-10.1-2.5-13.7-1.4-.6.2-1.2-.2-1.3-.7-.2-.6.2-1.2.7-1.3 4.2-1.3 11.1-1 15.5 1.6.5.3.7 1 .4 1.5-.3.5-1 .7-1.6.3z"
          />
        </svg>
      </a>
      {opened ? (
        <span
          className="text-[11px] font-semibold leading-none text-emerald-700"
          aria-hidden="true"
          title="Opened before"
        >
          ✓
        </span>
      ) : null}
    </span>
  );
}
