"use client";

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type MouseEvent,
} from "react";

const OPENED_KEY = "beatage.spotify-opened";
const PLAYING_URI_KEY = "beatage.spotify-playing-uri";
const PLAYING_DEVICE_KEY = "beatage.spotify-playing-device";

type PlayingSnapshot = {
  uri: string | null;
  deviceId: string | null;
};

type SpotifyTrackLinkProps = {
  href: string;
  uri?: string | null;
  openedKey?: string | null;
  className?: string;
  /** Host Connect playback — only the active track shows pause. */
  preferApiPlay?: boolean;
};

/**
 * Simple Icons “Spotify” (includes the green circle).
 * Single path — avoids broken arc logos.
 */
const SPOTIFY_ICON_PATH =
  "M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z";

const listeners = new Set<() => void>();
let memorySnapshot: PlayingSnapshot = { uri: null, deviceId: null };
const SERVER_SNAPSHOT: PlayingSnapshot = { uri: null, deviceId: null };

/** Bumps when pause starts so an in-flight play cannot restore the pause icon. */
let playGeneration = 0;


function readSnapshot(): PlayingSnapshot {
  if (typeof window === "undefined") return { uri: null, deviceId: null };
  try {
    return {
      uri: window.sessionStorage.getItem(PLAYING_URI_KEY),
      deviceId: window.sessionStorage.getItem(PLAYING_DEVICE_KEY),
    };
  } catch {
    return { uri: null, deviceId: null };
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function setPlayingSnapshot(uri: string | null, deviceId: string | null = null) {
  memorySnapshot = { uri, deviceId };
  try {
    if (uri) {
      window.sessionStorage.setItem(PLAYING_URI_KEY, uri);
      if (deviceId) window.sessionStorage.setItem(PLAYING_DEVICE_KEY, deviceId);
      else window.sessionStorage.removeItem(PLAYING_DEVICE_KEY);
    } else {
      window.sessionStorage.removeItem(PLAYING_URI_KEY);
      window.sessionStorage.removeItem(PLAYING_DEVICE_KEY);
    }
  } catch {
    // ignore
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return memorySnapshot;
}

function getServerSnapshot() {
  return SERVER_SNAPSHOT;
}

function normalizeTrackUri(href: string, uri?: string | null): string | null {
  const trimmed = uri?.trim();
  if (trimmed?.startsWith("spotify:track:")) {
    return trimmed.replace(/:play$/i, "");
  }
  try {
    const parsed = new URL(href);
    if (!parsed.hostname.includes("spotify.com")) return null;
    const match = parsed.pathname.match(/\/track\/([a-zA-Z0-9]+)/);
    return match?.[1] ? `spotify:track:${match[1]}` : null;
  } catch {
    return null;
  }
}

function readOpenedKeys(): Set<string> {
  try {
    const raw = window.localStorage.getItem(OPENED_KEY);
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
    window.localStorage.setItem(OPENED_KEY, JSON.stringify([...next]));
  } catch {
    // ignore
  }
}

/** Open Spotify desktop/mobile (non-host fallback). */
function wakeSpotifyApp(trackUri: string) {
  const anchor = document.createElement("a");
  anchor.href = trackUri;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

type ApiResponse = {
  ok?: boolean;
  deviceId?: string | null;
  code?: string;
  message?: string;
};

function sanitizeHint(message: string | null | undefined): string | null {
  if (!message) return null;
  const trimmed = message.trim();
  // Spotify device ids look like long base62 tokens — never show them in the UI.
  if (/^[a-zA-Z0-9_-]{16,64}$/.test(trimmed)) return null;
  if (/^spotify:/i.test(trimmed)) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return null;
  return trimmed.slice(0, 160);
}

async function requestPlay(trackUri: string): Promise<ApiResponse & { status: number }> {
  const response = await fetch("/api/spotify/play", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uri: trackUri }),
  });
  const data = (await response.json().catch(() => ({}))) as ApiResponse;
  return { ...data, status: response.status };
}

async function requestPause(deviceId: string | null): Promise<ApiResponse & { status: number }> {
  const response = await fetch("/api/spotify/pause", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(deviceId ? { deviceId } : {}),
  });
  const data = (await response.json().catch(() => ({}))) as ApiResponse;
  return { ...data, status: response.status };
}

/**
 * Host Spotify control: one play request, one pause request.
 * Spotify desktop must already be running (same account as Connect).
 */
export function SpotifyTrackLink({
  href,
  uri = null,
  openedKey = null,
  className,
  preferApiPlay = false,
}: SpotifyTrackLinkProps) {
  const trackUri = normalizeTrackUri(href, uri);
  const playing = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isThisTrackPlaying =
    Boolean(trackUri) && playing.uri != null && playing.uri === trackUri;

  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    memorySnapshot = readSnapshot();
    emit();
  }, []);

  useEffect(() => {
    if (!openedKey) {
      setOpened(false);
      return;
    }
    setOpened(readOpenedKeys().has(openedKey));
  }, [openedKey]);

  const play = useCallback(async () => {
    if (!trackUri) return;
    const generation = ++playGeneration;
    setHint(null);

    try {
      const data = await requestPlay(trackUri);
      // A pause click while play was in-flight wins — do not restore the pause icon.
      if (generation !== playGeneration) return;

      if (data.ok) {
        setPlayingSnapshot(
          trackUri,
          typeof data.deviceId === "string" ? data.deviceId : null,
        );
        return;
      }

      if (data.code === "not_connected" || data.status === 401) {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.assign(
          `/api/spotify/connect?next=${encodeURIComponent(next)}&play=${encodeURIComponent(trackUri)}`,
        );
        return;
      }

      setPlayingSnapshot(null);
      setHint(sanitizeHint(data.message) ?? `Play failed (${data.status})`);
    } catch {
      if (generation !== playGeneration) return;
      setPlayingSnapshot(null);
      setHint("Play request failed");
    }
  }, [trackUri]);

  const pause = useCallback(async () => {
    // Optimistic: clear pause icon immediately; invalidate any in-flight play.
    playGeneration += 1;
    setPlayingSnapshot(null);
    setHint(null);

    try {
      const data = await requestPause(null);

      if (data.code === "not_connected" || data.status === 401) {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.assign(
          `/api/spotify/connect?next=${encodeURIComponent(next)}`,
        );
      }
      // Do not show pause errors — Spotify often pauses while returning a
      // non-ok API status, and the icon is already cleared.
    } catch {
      // Keep UI cleared; song usually already stopped.
    }
  }, []);

  async function onClick(event: MouseEvent<HTMLButtonElement>) {
    if (openedKey) {
      markOpenedKey(openedKey);
      setOpened(true);
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();

    if (!preferApiPlay) {
      if (trackUri) wakeSpotifyApp(trackUri);
      else window.open(href, "_blank", "noopener,noreferrer");
      return;
    }

    if (!trackUri) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }

    setBusy(true);
    if (playing.uri === trackUri) {
      await pause();
    } else {
      await play();
    }
    setBusy(false);
  }

  const label = busy
    ? isThisTrackPlaying
      ? "Pausing…"
      : "Starting…"
    : preferApiPlay && isThisTrackPlaying
      ? "Pause Spotify"
      : "Play in Spotify";

  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ""}`}>
      <button
        type="button"
        onClick={(event) => {
          void onClick(event);
        }}
        title={hint ? `${label} — ${hint}` : label}
        aria-label={label}
        aria-busy={busy}
        aria-pressed={isThisTrackPlaying}
        className={
          preferApiPlay && isThisTrackPlaying
            ? "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-2 ring-emerald-900 ring-offset-1 transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954]"
            : "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954]"
        }
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          {preferApiPlay && isThisTrackPlaying ? (
            <>
              <circle cx="12" cy="12" r="12" fill="#1DB954" />
              <rect x="7" y="6.5" width="3.5" height="11" rx="0.5" fill="#000" />
              <rect x="13.5" y="6.5" width="3.5" height="11" rx="0.5" fill="#000" />
            </>
          ) : (
            <path fill="#1DB954" d={SPOTIFY_ICON_PATH} />
          )}
        </svg>
      </button>
      {opened ? (
        <span
          className="text-[11px] font-semibold leading-none text-emerald-700"
          aria-hidden="true"
        >
          ✓
        </span>
      ) : null}
      {hint && preferApiPlay ? (
        <span
          className="max-w-[14rem] text-[10px] leading-snug text-amber-800"
          title={hint}
        >
          {hint}
        </span>
      ) : null}
    </span>
  );
}
