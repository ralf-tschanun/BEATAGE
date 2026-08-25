"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  interruptAutoSpotifyQuizAction,
  resumeAutoSpotifyQuizAction,
  skipSpotifyNextAction,
  syncAutoSpotifyRoundAction,
} from "@/app/actions/quiz-round";
import { QuizPlanLimitPrompt } from "@/components/quiz-plan-limit-prompt";
import { Button, buttonVariants } from "@/components/ui/button";
import { isQuizPlanLimitError } from "@/lib/quiz-plan-limits";
import type { PlanId } from "@/lib/quiz-plans";
import { cn } from "@/lib/utils";

const POLL_MS = 5000;
const DEBOUNCE_MS = 5000;

type AutoSpotifyHostControlsProps = {
  quizId: string;
  joinCode: string;
  disabled?: boolean;
  /** Server-side pause (manual or after consecutive empty rounds). */
  autoInterrupted?: boolean;
  emptyStreakThreshold?: number;
  planId?: PlanId;
  isAnonymous?: boolean;
  unlocked?: boolean;
  roundLimit?: number | null;
  currentRoundNumber?: number;
};

type NowPlayingTrack = {
  isPlaying: boolean;
  spotifyTrackId: string;
  title: string;
  artist: string;
  albumArtUrl?: string | null;
  releaseYear?: number | null;
};

/** Host Auto Spotify: poll now-playing and open/close rounds with a 5s debounce. */
export function AutoSpotifyHostControls({
  quizId,
  joinCode,
  disabled = false,
  autoInterrupted = false,
  emptyStreakThreshold = 3,
  planId = "free",
  isAnonymous = false,
  unlocked = false,
  roundLimit = null,
  currentRoundNumber = 0,
}: AutoSpotifyHostControlsProps) {
  const router = useRouter();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [status, setStatus] = useState("Connecting…");
  const [nowPlaying, setNowPlaying] = useState<NowPlayingTrack | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planLimitError, setPlanLimitError] = useState<string | null>(null);

  const pendingSpotifyIdRef = useRef<string | null>(null);
  const lastSpotifyIdRef = useRef<string | null>(null);
  /** After "Close this round": keep listening but do not reopen until the song changes. */
  const deferredTrackIdRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const wasPlayingRef = useRef(false);

  const clearDebounce = useCallback(() => {
    if (debounceTimerRef.current != null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = null;
  }, []);

  const trackLabel = useCallback((track: NowPlayingTrack) => {
    return `${track.title} — ${track.artist}`;
  }, []);

  const runSync = useCallback(
    async (opts?: {
      forceClose?: boolean;
      openNewRound?: boolean;
      nowPlaying?:
        | { playing: false }
        | {
            playing: true;
            spotifyTrackId: string;
            title: string;
            artist: string;
            albumArtUrl?: string | null;
            releaseYear?: number | null;
            isPlaying?: boolean;
          };
    }) => {
      setBusy(true);
      setError(null);
      try {
        const result = await syncAutoSpotifyRoundAction(quizId, joinCode, opts);
        if (result.error) {
          if (isQuizPlanLimitError(result.error)) {
            setPlanLimitError(result.error);
            setError(null);
            setStatus(
              "Round limit reached — unlock, change plan, or finish the quiz.",
            );
          } else {
            setError(result.error);
          }
          return result;
        }
        if (result.interrupted) {
          clearDebounce();
          pendingSpotifyIdRef.current = null;
          setStatus(
            `Interrupted — ${emptyStreakThreshold} songs in a row had no guesses.`,
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
          setStatus("Round closed — results are on the board");
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
            await runSync({
              openNewRound: true,
              nowPlaying: {
                playing: true,
                spotifyTrackId: data.track.spotifyTrackId,
                title: data.track.title,
                artist: data.track.artist,
                albumArtUrl: data.track.albumArtUrl ?? null,
                releaseYear: data.track.releaseYear ?? null,
                isPlaying: data.track.isPlaying,
              },
            });
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

  const atRoundLimit =
    Boolean(planLimitError) ||
    (roundLimit != null && currentRoundNumber >= roundLimit);

  useEffect(() => {
    if (autoInterrupted) {
      clearDebounce();
      pendingSpotifyIdRef.current = null;
    }
  }, [autoInterrupted, clearDebounce]);

  useEffect(() => {
    if (autoInterrupted || disabled || atRoundLimit || connected !== true) {
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
            deferredTrackIdRef.current = null;
            clearDebounce();
            pendingSpotifyIdRef.current = null;
            setStatus("Track ended — closing round…");
            await runSync({
              forceClose: true,
              openNewRound: false,
              nowPlaying: { playing: false },
            });
          } else {
            setStatus("Nothing playing — start a song in Spotify");
          }
          return;
        }

        const track = data.track;
        setNowPlaying(track);
        const label = trackLabel(track);

        if (!track.isPlaying) {
          setStatus(`Paused — ${label}`);
          return;
        }

        const changed = lastSpotifyIdRef.current !== track.spotifyTrackId;
        if (changed) {
          deferredTrackIdRef.current = null;
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
        if (deferredTrackIdRef.current === track.spotifyTrackId) {
          setStatus(`Listening — ${label} (round closed, next song continues automatically)`);
          return;
        }
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
    atRoundLimit,
    autoInterrupted,
    disabled,
    connected,
    clearDebounce,
    runSync,
    scheduleOpen,
    trackLabel,
  ]);

  async function onCloseThisRound() {
    clearDebounce();
    pendingSpotifyIdRef.current = null;
    setStatus("Closing round…");
    const result = await runSync({ forceClose: true, openNewRound: false });
    if (result?.error) return;
    const trackId = nowPlaying?.spotifyTrackId ?? lastSpotifyIdRef.current;
    if (trackId) {
      deferredTrackIdRef.current = trackId;
    }
    if (nowPlaying) {
      setStatus(
        `Round closed — ${trackLabel(nowPlaying)} (next song continues automatically)`,
      );
    } else {
      setStatus("Round closed — results are on the board");
    }
  }

  async function onInterruptOrContinue() {
    if (autoInterrupted) {
      setBusy(true);
      setError(null);
      try {
        const result = await resumeAutoSpotifyQuizAction(quizId, joinCode);
        if (result.error) {
          setError(result.error);
          return;
        }
        deferredTrackIdRef.current = null;
        setStatus("Continuing — waiting for Spotify…");
        lastSpotifyIdRef.current = null;
        router.refresh();
      } finally {
        setBusy(false);
      }
      return;
    }

    clearDebounce();
    pendingSpotifyIdRef.current = null;
    setBusy(true);
    setError(null);
    try {
      setStatus("Interrupted — closing round…");
      const result = await interruptAutoSpotifyQuizAction(quizId, joinCode);
      if (result.error) {
        setError(result.error);
        return;
      }
      const trackId = nowPlaying?.spotifyTrackId ?? lastSpotifyIdRef.current;
      if (trackId) {
        deferredTrackIdRef.current = trackId;
      }
      setStatus("Paused — press Resume to continue Auto Spotify");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onPlayNext() {
    setBusy(true);
    setError(null);
    try {
      deferredTrackIdRef.current = null;
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
    <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
      <div>
        <h2 className="text-lg font-semibold">Auto Spotify</h2>
        <p className="text-sm text-muted-foreground">{status}</p>
      </div>

      {atRoundLimit ? (
        <QuizPlanLimitPrompt
          quizId={quizId}
          joinCode={joinCode}
          message={planLimitError}
          kind="rounds"
          cap={roundLimit}
          planId={planId}
          isAnonymous={isAnonymous}
          unlocked={unlocked}
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || busy || autoInterrupted}
          onClick={() => {
            void onCloseThisRound();
          }}
        >
          End this round
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || busy || autoInterrupted || atRoundLimit}
          onClick={() => {
            void onPlayNext();
          }}
        >
          Play next
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={
            disabled ||
            busy ||
            (autoInterrupted ? atRoundLimit : false)
          }
          onClick={() => {
            void onInterruptOrContinue();
          }}
        >
          {autoInterrupted ? "Resume" : "Pause"}
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
