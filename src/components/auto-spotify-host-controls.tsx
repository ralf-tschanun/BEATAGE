"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  resumeAutoSpotifyQuizAction,
  skipSpotifyNextAction,
  syncAutoSpotifyRoundAction,
} from "@/app/actions/quiz-round";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const POLL_MS = 2500;
const DEBOUNCE_MS = 5000;

type AutoSpotifyHostControlsProps = {
  quizId: string;
  joinCode: string;
  disabled?: boolean;
  /** Server-side pause after consecutive empty rounds. */
  autoInterrupted?: boolean;
  emptyStreakThreshold?: number;
};

type NowPlayingTrack = {
  isPlaying: boolean;
  spotifyTrackId: string;
  title: string;
  artist: string;
};

/** Host Auto Spotify: poll now-playing and open/close rounds with a 5s debounce. */
export function AutoSpotifyHostControls({
  quizId,
  joinCode,
  disabled = false,
  autoInterrupted = false,
  emptyStreakThreshold = 3,
}: AutoSpotifyHostControlsProps) {
  const router = useRouter();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [pausedByHost, setPausedByHost] = useState(false);
  const [serverInterrupted, setServerInterrupted] = useState(autoInterrupted);
  const [status, setStatus] = useState("Connecting…");
  const [nowPlaying, setNowPlaying] = useState<NowPlayingTrack | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingSpotifyIdRef = useRef<string | null>(null);
  const lastSpotifyIdRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const wasPlayingRef = useRef(false);

  useEffect(() => {
    setServerInterrupted(autoInterrupted);
    if (autoInterrupted) {
      setPausedByHost(true);
      setStatus(
        `Interrupted — ${emptyStreakThreshold} songs in a row had no guesses. Press Continue to resume.`,
      );
    }
  }, [autoInterrupted, emptyStreakThreshold]);

  const clearDebounce = useCallback(() => {
    if (debounceTimerRef.current != null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = null;
  }, []);

  const runSync = useCallback(
    async (opts?: { forceClose?: boolean; openNewRound?: boolean }) => {
      setBusy(true);
      setError(null);
      try {
        const result = await syncAutoSpotifyRoundAction(quizId, joinCode, opts);
        if (result.error) {
          setError(result.error);
          return result;
        }
        if (result.interrupted) {
          setServerInterrupted(true);
          setPausedByHost(true);
          clearDebounce();
          pendingSpotifyIdRef.current = null;
          setStatus(
            `Interrupted — ${emptyStreakThreshold} songs in a row had no guesses. Press Continue to resume.`,
          );
        } else if (result.startedRound) {
          setStatus(
            `Round open — ${result.trackTitle ?? "track"}` +
              (result.trackArtist ? ` — ${result.trackArtist}` : ""),
          );
        } else if (result.closedRound && result.nothingPlaying) {
          setStatus("Round closed — nothing playing");
        } else if (result.nothingPlaying) {
          setStatus("Nothing playing on Spotify");
        } else if (result.closedRound) {
          setStatus("Round closed & revealed");
        }
        router.refresh();
        return result;
      } finally {
        setBusy(false);
      }
    },
    [quizId, joinCode, router, clearDebounce, emptyStreakThreshold],
  );

  const scheduleOpen = useCallback(
    (spotifyTrackId: string, label: string) => {
      if (
        pendingSpotifyIdRef.current === spotifyTrackId &&
        debounceTimerRef.current != null
      ) {
        return;
      }
      clearDebounce();
      pendingSpotifyIdRef.current = spotifyTrackId;
      setStatus(`New song detected — starting in 5s (${label})`);
      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null;
        void (async () => {
          try {
            const response = await fetch("/api/spotify/now-playing", {
              cache: "no-store",
            });
            const data = (await response.json()) as {
              ok?: boolean;
              playing?: boolean;
              track?: NowPlayingTrack;
              message?: string;
            };
            if (!response.ok || !data.ok) {
              setError(data.message ?? "Could not read Spotify now playing.");
              return;
            }
            if (
              !data.playing ||
              !data.track ||
              data.track.spotifyTrackId !== spotifyTrackId ||
              !data.track.isPlaying
            ) {
              setStatus("Song changed again — waiting…");
              pendingSpotifyIdRef.current = null;
              return;
            }
            pendingSpotifyIdRef.current = null;
            await runSync();
          } catch {
            setError("Could not start the round from Spotify.");
          }
        })();
      }, DEBOUNCE_MS);
    },
    [clearDebounce, runSync],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/spotify/status", { cache: "no-store" });
        const data = (await response.json()) as { connected?: boolean };
        if (!cancelled) {
          setConnected(Boolean(data.connected));
          if (!data.connected) setStatus("Spotify not connected");
        }
      } catch {
        if (!cancelled) {
          setConnected(false);
          setStatus("Spotify not connected");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const followPaused = pausedByHost || serverInterrupted;

  useEffect(() => {
    if (followPaused || disabled || connected !== true) {
      clearDebounce();
      return;
    }

    let cancelled = false;

    const poll = async () => {
      if (cancelled || document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/spotify/now-playing", {
          cache: "no-store",
        });
        const data = (await response.json()) as {
          ok?: boolean;
          playing?: boolean;
          track?: NowPlayingTrack;
          code?: string;
          message?: string;
        };

        if (!response.ok || !data.ok) {
          if (data.code === "not_connected") setConnected(false);
          setError(data.message ?? "Spotify now-playing failed.");
          return;
        }
        setError(null);

        if (!data.playing || !data.track) {
          setNowPlaying(null);
          if (wasPlayingRef.current) {
            wasPlayingRef.current = false;
            lastSpotifyIdRef.current = null;
            clearDebounce();
            pendingSpotifyIdRef.current = null;
            setStatus("Track ended — closing round…");
            await runSync({ forceClose: true, openNewRound: false });
          } else {
            setStatus("Nothing playing — start a song in Spotify");
          }
          return;
        }

        const track = data.track;
        setNowPlaying(track);
        const label = `${track.title} — ${track.artist}`;

        if (!track.isPlaying) {
          setStatus(`Paused — ${label}`);
          return;
        }

        const changed = lastSpotifyIdRef.current !== track.spotifyTrackId;
        if (changed) {
          const previous = lastSpotifyIdRef.current;
          lastSpotifyIdRef.current = track.spotifyTrackId;
          wasPlayingRef.current = true;
          if (previous) {
            setStatus("Song changed — revealing previous round…");
            await runSync({ forceClose: true, openNewRound: false });
          }
          scheduleOpen(track.spotifyTrackId, label);
          return;
        }

        wasPlayingRef.current = true;
        if (pendingSpotifyIdRef.current == null) {
          setStatus(`Listening — ${label}`);
        }
      } catch {
        if (!cancelled) setError("Spotify poll failed.");
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      clearDebounce();
    };
  }, [
    followPaused,
    disabled,
    connected,
    clearDebounce,
    runSync,
    scheduleOpen,
  ]);

  async function onInterrupt() {
    setPausedByHost(true);
    clearDebounce();
    pendingSpotifyIdRef.current = null;
    setStatus("Interrupted — closing round…");
    await runSync({ forceClose: true, openNewRound: false });
    setStatus("Interrupted — press Continue to resume Auto Spotify");
  }

  async function onContinue() {
    setBusy(true);
    setError(null);
    try {
      if (serverInterrupted) {
        const result = await resumeAutoSpotifyQuizAction(quizId, joinCode);
        if (result.error) {
          setError(result.error);
          return;
        }
        setServerInterrupted(false);
      }
      setPausedByHost(false);
      setStatus("Continuing — waiting for Spotify…");
      lastSpotifyIdRef.current = null;
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onPlayNext() {
    setBusy(true);
    setError(null);
    try {
      const skipped = await skipSpotifyNextAction(quizId, joinCode);
      if (skipped.error) {
        setError(skipped.error);
        return;
      }
      setStatus("Skipped — waiting for next song…");
      lastSpotifyIdRef.current = null;
    } finally {
      setBusy(false);
    }
  }

  if (connected === false) {
    const nextPath =
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : "/";
    return (
      <section className="space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
        <h2 className="text-lg font-semibold">Auto Spotify</h2>
        <p className="text-sm text-muted-foreground">
          Connect the same Spotify Premium account that is playing music on this
          computer.
        </p>
        <a
          className={cn(buttonVariants())}
          href={`/api/spotify/connect?next=${encodeURIComponent(nextPath)}`}
        >
          Connect Spotify
        </a>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl border border-border/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Auto Spotify</h2>
          <p className="text-sm text-muted-foreground">{status}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!followPaused}
            disabled={disabled || busy || connected !== true}
            onChange={(event) => {
              if (event.target.checked) {
                void onContinue();
              } else {
                setPausedByHost(true);
                clearDebounce();
                setStatus("Auto paused");
              }
            }}
          />
          Follow playback
        </label>
      </div>

      {serverInterrupted ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-foreground">
          Auto Spotify paused after {emptyStreakThreshold} songs without any
          guesses. Continue when players are ready.
        </p>
      ) : null}

      {nowPlaying ? (
        <p className="text-sm">
          <span className="font-medium">{nowPlaying.title}</span>
          {" — "}
          {nowPlaying.artist}
          {nowPlaying.isPlaying ? "" : " (paused)"}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || busy}
          onClick={() => {
            void onInterrupt();
          }}
        >
          Interrupt
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || busy || !followPaused}
          onClick={() => {
            void onContinue();
          }}
        >
          Continue
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || busy}
          onClick={() => {
            void onPlayNext();
          }}
        >
          Play next song
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
