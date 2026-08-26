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
import { LiveHostScreenLockField } from "@/components/live-host-screen-lock-field";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isQuizPlanLimitError } from "@/lib/quiz-plan-limits";
import type { PlanId } from "@/lib/quiz-plans";
import { cn } from "@/lib/utils";

const POLL_MS = 5000;
const DEFAULT_LISTEN_SECONDS = 5;
const MIN_LISTEN_SECONDS = 1;
const MAX_LISTEN_SECONDS = 120;

type OpenMode = "automatic" | "manual";

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
  /** True while a round is open for guesses — Close this round is only useful then. */
  hasActiveRound?: boolean;
  canFinish?: boolean;
  finishAction?: (formData: FormData) => void | Promise<void>;
  finishPending?: boolean;
  finishError?: string | null;
};

type NowPlayingTrack = {
  isPlaying: boolean;
  spotifyTrackId: string;
  title: string;
  artist: string;
  albumArtUrl?: string | null;
  releaseYear?: number | null;
};

function clampListenSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LISTEN_SECONDS;
  return Math.min(
    MAX_LISTEN_SECONDS,
    Math.max(MIN_LISTEN_SECONDS, Math.round(value)),
  );
}

/** Host Auto Spotify: poll now-playing and open/close rounds with host listen mode. */
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
  hasActiveRound = false,
  canFinish = false,
  finishAction,
  finishPending = false,
  finishError = null,
}: AutoSpotifyHostControlsProps) {
  const router = useRouter();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [status, setStatus] = useState("Connecting…");
  const [nowPlaying, setNowPlaying] = useState<NowPlayingTrack | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planLimitError, setPlanLimitError] = useState<string | null>(null);
  const [openMode, setOpenMode] = useState<OpenMode>("automatic");
  const [listenSeconds, setListenSeconds] = useState(DEFAULT_LISTEN_SECONDS);
  const [listenSecondsDraft, setListenSecondsDraft] = useState(
    String(DEFAULT_LISTEN_SECONDS),
  );
  const [pendingReveal, setPendingReveal] = useState(false);
  const [endQuizConfirmOpen, setEndQuizConfirmOpen] = useState(false);
  /** True while Automatic mode is counting down before opening the round. */
  const [awaitingAutoOpen, setAwaitingAutoOpen] = useState(false);
  /** Optimistic: disable Close immediately on click until hasActiveRound clears. */
  const [closeInFlight, setCloseInFlight] = useState(false);

  const pendingSpotifyIdRef = useRef<string | null>(null);
  const lastSpotifyIdRef = useRef<string | null>(null);
  /** After "Close this round": keep listening but do not reopen until the song changes. */
  const deferredTrackIdRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const wasPlayingRef = useRef(false);
  const openModeRef = useRef<OpenMode>(openMode);
  const listenSecondsRef = useRef(listenSeconds);

  useEffect(() => {
    openModeRef.current = openMode;
  }, [openMode]);

  useEffect(() => {
    listenSecondsRef.current = listenSeconds;
  }, [listenSeconds]);

  useEffect(() => {
    if (!hasActiveRound) setCloseInFlight(false);
  }, [hasActiveRound]);

  const clearDebounce = useCallback(() => {
    if (debounceTimerRef.current != null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = null;
    setAwaitingAutoOpen(false);
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
          setPendingReveal(false);
          setAwaitingAutoOpen(false);
          setStatus(
            `Interrupted — ${emptyStreakThreshold} songs in a row had no guesses.`,
          );
        } else if (result.startedRound) {
          setPendingReveal(false);
          setAwaitingAutoOpen(false);
          setCloseInFlight(false);
          setStatus(
            `Round open — ${result.trackTitle ?? "track"}` +
              (result.trackArtist ? ` — ${result.trackArtist}` : ""),
          );
        } else if (result.closedRound && result.nothingPlaying) {
          setCloseInFlight(false);
          setStatus("Round closed — nothing playing");
        } else if (result.nothingPlaying) {
          setStatus("Nothing playing on Spotify");
        } else if (result.closedRound) {
          setCloseInFlight(false);
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

  const openPendingTrack = useCallback(
    async (spotifyTrackId: string) => {
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
          setAwaitingAutoOpen(false);
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
          setPendingReveal(false);
          setAwaitingAutoOpen(false);
          return;
        }
        pendingSpotifyIdRef.current = null;
        setPendingReveal(false);
        setAwaitingAutoOpen(false);
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
        pendingSpotifyIdRef.current = null;
        setPendingReveal(false);
        setAwaitingAutoOpen(false);
      }
    },
    [runSync],
  );

  const scheduleOpen = useCallback(
    (spotifyTrackId: string, label: string) => {
      if (deferredTrackIdRef.current === spotifyTrackId) {
        setStatus(`Waiting for next song (ended ${label})`);
        setPendingReveal(false);
        setAwaitingAutoOpen(false);
        return;
      }
      // Already waiting on this track (automatic timer or manual reveal).
      if (
        pendingSpotifyIdRef.current === spotifyTrackId &&
        (debounceTimerRef.current != null || openModeRef.current === "manual")
      ) {
        return;
      }
      clearDebounce();
      pendingSpotifyIdRef.current = spotifyTrackId;

      if (openModeRef.current === "manual") {
        setAwaitingAutoOpen(false);
        setPendingReveal(true);
        setStatus(`Detected: ${label} — waiting for reveal`);
        return;
      }

      setPendingReveal(false);
      setAwaitingAutoOpen(true);
      const seconds = clampListenSeconds(listenSecondsRef.current);
      setStatus(`New song detected — starting in ${seconds}s (${label})`);
      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null;
        void openPendingTrack(spotifyTrackId);
      }, seconds * 1000);
    },
    [clearDebounce, openPendingTrack],
  );

  const scheduleOpenRef = useRef(scheduleOpen);
  useEffect(() => {
    scheduleOpenRef.current = scheduleOpen;
  }, [scheduleOpen]);

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
      setPendingReveal(false);
      setAwaitingAutoOpen(false);
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
            setPendingReveal(false);
            setAwaitingAutoOpen(false);
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
          clearDebounce();
          pendingSpotifyIdRef.current = null;
          setPendingReveal(false);
          setAwaitingAutoOpen(false);
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

  function applyListenSeconds(raw: string) {
    const parsed = Number.parseInt(raw, 10);
    const next = clampListenSeconds(parsed);
    setListenSeconds(next);
    setListenSecondsDraft(String(next));
    listenSecondsRef.current = next;

    if (
      openModeRef.current === "automatic" &&
      pendingSpotifyIdRef.current != null &&
      nowPlaying &&
      pendingSpotifyIdRef.current === nowPlaying.spotifyTrackId &&
      deferredTrackIdRef.current !== nowPlaying.spotifyTrackId
    ) {
      clearDebounce();
      pendingSpotifyIdRef.current = null;
      scheduleOpenRef.current(
        nowPlaying.spotifyTrackId,
        trackLabel(nowPlaying),
      );
    }
  }

  function onOpenModeChange(mode: OpenMode) {
    if (mode === openMode) return;
    setOpenMode(mode);
    openModeRef.current = mode;

    const track = nowPlaying;
    const pendingId = pendingSpotifyIdRef.current;
    if (!track || pendingId !== track.spotifyTrackId) return;
    if (deferredTrackIdRef.current === track.spotifyTrackId) return;
    if (autoInterrupted) return;

    clearDebounce();
    pendingSpotifyIdRef.current = null;
    setPendingReveal(false);
    scheduleOpenRef.current(track.spotifyTrackId, trackLabel(track));
  }

  async function onRevealNow() {
    const track = nowPlaying;
    if (!track || pendingSpotifyIdRef.current !== track.spotifyTrackId) return;
    if (deferredTrackIdRef.current === track.spotifyTrackId) return;
    clearDebounce();
    setBusy(true);
    try {
      await openPendingTrack(track.spotifyTrackId);
    } finally {
      setBusy(false);
    }
  }

  async function onCloseThisRound() {
    clearDebounce();
    pendingSpotifyIdRef.current = null;
    setPendingReveal(false);
    setAwaitingAutoOpen(false);
    setCloseInFlight(true);
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
        setPendingReveal(false);
        setAwaitingAutoOpen(false);
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
    setPendingReveal(false);
    setAwaitingAutoOpen(false);
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
      setPendingReveal(false);
      setAwaitingAutoOpen(false);
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

  const hostBusy = disabled || busy;
  /** Only while a round is open for guesses — not during listen/reveal wait. */
  const canCloseThisRound =
    hasActiveRound &&
    !pendingReveal &&
    !awaitingAutoOpen &&
    !closeInFlight &&
    !autoInterrupted &&
    !hostBusy;
  const revealNowEnabled =
    !hostBusy &&
    !autoInterrupted &&
    !atRoundLimit &&
    pendingReveal &&
    nowPlaying != null &&
    pendingSpotifyIdRef.current === nowPlaying.spotifyTrackId;

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
        <LiveHostScreenLockField id="spotify-screen-lock-setup" disabled={disabled} />
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

      <div className="border-t border-border/60" />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="inline-flex rounded-2xl border border-border/60 p-0.5"
            role="radiogroup"
            aria-label="Round open mode"
          >
            <Button
              type="button"
              size="sm"
              variant={openMode === "automatic" ? "default" : "ghost"}
              className={cn(
                "rounded-[14px]",
                openMode !== "automatic" && "text-muted-foreground",
              )}
              disabled={hostBusy}
              aria-checked={openMode === "automatic"}
              role="radio"
              onClick={() => onOpenModeChange("automatic")}
            >
              Automatic
            </Button>
            <Button
              type="button"
              size="sm"
              variant={openMode === "manual" ? "default" : "ghost"}
              className={cn(
                "rounded-[14px]",
                openMode !== "manual" && "text-muted-foreground",
              )}
              disabled={hostBusy}
              aria-checked={openMode === "manual"}
              role="radio"
              onClick={() => onOpenModeChange("manual")}
            >
              Manual
            </Button>
          </div>

          {openMode === "automatic" ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Label htmlFor="spotify-listen-seconds" className="font-normal">
                after
              </Label>
              <Input
                id="spotify-listen-seconds"
                type="number"
                inputMode="numeric"
                min={MIN_LISTEN_SECONDS}
                max={MAX_LISTEN_SECONDS}
                value={listenSecondsDraft}
                disabled={hostBusy}
                className="h-8 w-16"
                onChange={(event) => setListenSecondsDraft(event.target.value)}
                onBlur={() => applyListenSeconds(listenSecondsDraft)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
              />
              <span>sec.</span>
            </div>
          ) : null}
        </div>

        {openMode === "manual" ? (
          <Button
            type="button"
            className="w-full sm:w-auto"
            disabled={!revealNowEnabled}
            onClick={() => {
              void onRevealNow();
            }}
          >
            Reveal now
          </Button>
        ) : null}
      </div>

      <div className="border-t border-border/60" />

      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={!canCloseThisRound}
          onClick={() => {
            void onCloseThisRound();
          }}
        >
          Close this round
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={
            hostBusy || (autoInterrupted ? atRoundLimit : false)
          }
          onClick={() => {
            void onInterruptOrContinue();
          }}
        >
          {autoInterrupted ? "Resume this Quiz" : "Pause this Quiz"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full sm:col-span-2"
          disabled={hostBusy || autoInterrupted || atRoundLimit}
          onClick={() => {
            void onPlayNext();
          }}
        >
          Play next
        </Button>
      </div>

      {canFinish && finishAction ? (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={finishPending || disabled}
          onClick={() => setEndQuizConfirmOpen(true)}
        >
          {finishPending ? "Ending…" : "End this Quiz"}
        </Button>
      ) : null}

      <LiveHostScreenLockField id="spotify-screen-lock" disabled={disabled} />

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {finishError ? (
        <p className="text-sm text-destructive" role="alert">
          {finishError}
        </p>
      ) : null}

      <Dialog open={endQuizConfirmOpen} onOpenChange={setEndQuizConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>End this quiz?</DialogTitle>
            <DialogDescription>
              Are you sure? This ends the quiz permanently — players can no longer
              guess, and you cannot continue this live session.
            </DialogDescription>
          </DialogHeader>
          <form
            action={finishAction}
            onSubmit={() => setEndQuizConfirmOpen(false)}
          >
            <input type="hidden" name="quizId" value={quizId} />
            <input type="hidden" name="joinCode" value={joinCode} />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={finishPending}
                onClick={() => setEndQuizConfirmOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={finishPending}>
                {finishPending ? "Ending…" : "Yes, end this quiz"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
