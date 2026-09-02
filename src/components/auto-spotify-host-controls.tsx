"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  interruptAutoSpotifyQuizAction,
  resumeAutoSpotifyQuizAction,
  skipActiveRoundAction,
  skipSpotifyNextAction,
  startOfficialQuizAction,
  syncAutoSpotifyRoundAction,
} from "@/app/actions/quiz-round";
import { QuizPlanLimitPrompt } from "@/components/quiz-plan-limit-prompt";
import { LiveHostScreenLockField } from "@/components/live-host-screen-lock-field";
import { LiveQuizInactivityNotice } from "@/components/live-quiz-inactivity-notice";
import { StartQuizNowDialog } from "@/components/start-quiz-now-dialog";
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
  autoEmptyStreak?: number;
  /** False while the quiz is still in pre-round warm-up. */
  quizStarted?: boolean;
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
  /** Skip outer card chrome when wrapped in CollapsibleCard. */
  embedded?: boolean;
  /** Team mode: block Start Quiz Now until teams are ready. */
  officialStartBlockedReason?: string | null;
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
  autoEmptyStreak = 0,
  quizStarted = true,
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
  embedded = false,
  officialStartBlockedReason = null,
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
  const [skipConfirmOpen, setSkipConfirmOpen] = useState(false);
  const [startQuizConfirmOpen, setStartQuizConfirmOpen] = useState(false);
  const [inactivityNotifySignal, setInactivityNotifySignal] = useState(0);
  const [localQuizStarted, setLocalQuizStarted] = useState(quizStarted);
  const localQuizStartedRef = useRef(quizStarted);
  useEffect(() => {
    setLocalQuizStarted(quizStarted);
    localQuizStartedRef.current = quizStarted;
  }, [quizStarted]);
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
          const streak = result.emptyStreak ?? 0;
          if (streak >= emptyStreakThreshold) {
            setInactivityNotifySignal((n) => n + 1);
          }
          setStatus(
            `Interrupted — ${Math.max(streak, emptyStreakThreshold)} songs in a row had no guesses.`,
          );
        } else if (result.startedRound) {
          setPendingReveal(false);
          setAwaitingAutoOpen(false);
          setCloseInFlight(false);
          setStatus(
            `${localQuizStartedRef.current ? "Round" : "Pre Round"} open — ${result.trackTitle ?? "track"}` +
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
    (roundLimit != null &&
      currentRoundNumber >= roundLimit &&
      !hasActiveRound);

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

  async function onSkipThisSong() {
    if (!hasActiveRound) return;
    clearDebounce();
    pendingSpotifyIdRef.current = null;
    setPendingReveal(false);
    setAwaitingAutoOpen(false);
    setBusy(true);
    setError(null);
    try {
      setStatus("Skipping song…");
      const result = await skipActiveRoundAction(quizId, joinCode, {
        advanceSpotify: true,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      const trackId = nowPlaying?.spotifyTrackId ?? lastSpotifyIdRef.current;
      if (trackId) {
        deferredTrackIdRef.current = trackId;
      }
      lastSpotifyIdRef.current = null;
      setStatus("Skipped — waiting for next song…");
      router.refresh();
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

  async function onStartQuizNow(includeCurrentSong: boolean) {
    if (localQuizStarted || hostBusy) return;
    clearDebounce();
    pendingSpotifyIdRef.current = null;
    setPendingReveal(false);
    setAwaitingAutoOpen(false);
    setBusy(true);
    setError(null);
    setStatus("Starting quiz…");
    try {
      const result = await startOfficialQuizAction(quizId, joinCode, {
        includeCurrentSong,
      });
      if (result.error) {
        setError(result.error);
        setStatus("Could not start the quiz");
        return;
      }
      setLocalQuizStarted(true);
      localQuizStartedRef.current = true;
      if (includeCurrentSong) {
        deferredTrackIdRef.current = null;
        if (result.promotedRound) {
          setStatus("Quiz started — this song is Round 1");
          router.refresh();
          return;
        }
        if (nowPlaying) {
          const sync = await runSync({
            openNewRound: true,
            nowPlaying: {
              playing: true,
              spotifyTrackId: nowPlaying.spotifyTrackId,
              title: nowPlaying.title,
              artist: nowPlaying.artist,
              albumArtUrl: nowPlaying.albumArtUrl ?? null,
              releaseYear: nowPlaying.releaseYear ?? null,
              isPlaying: nowPlaying.isPlaying,
            },
          });
          if (sync?.error) {
            router.refresh();
            return;
          }
          if (!sync?.startedRound) {
            setStatus("Quiz started — this song is Round 1");
            router.refresh();
          }
          return;
        }
        setStatus("Quiz started — waiting for a song to open Round 1");
        router.refresh();
        return;
      }
      const trackId = nowPlaying?.spotifyTrackId ?? lastSpotifyIdRef.current;
      if (trackId) {
        deferredTrackIdRef.current = trackId;
      }
      setStatus("Quiz started — next song opens Round 1");
      router.refresh();
    } catch {
      setError("Could not start the quiz.");
      setStatus("Could not start the quiz");
    } finally {
      setBusy(false);
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
  const canStartWithThisSong =
    hasActiveRound ||
    (nowPlaying != null &&
      deferredTrackIdRef.current !== nowPlaying.spotifyTrackId);
  /** Only while a round is open for guesses — not during listen/reveal wait. */
  const canSkipThisSong =
    hasActiveRound &&
    !pendingReveal &&
    !awaitingAutoOpen &&
    !autoInterrupted &&
    !hostBusy;
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
      <section
        className={
          embedded
            ? "space-y-3"
            : "space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4"
        }
      >
        {embedded ? null : (
          <h2 className="text-lg font-semibold">Auto Spotify</h2>
        )}
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
    <section
      className={
        embedded
          ? "space-y-3"
          : "space-y-3 rounded-2xl border border-border/60 bg-card p-4"
      }
    >
      <div>
        {embedded ? null : (
          <h2 className="text-lg font-semibold">Auto Spotify</h2>
        )}
        <p className="text-sm text-muted-foreground">{status}</p>
        {!localQuizStarted ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Pre-rounds are running so everyone can practice. Scores are saved but
            do not count on the leaderboard until you start the quiz.
          </p>
        ) : null}
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

      {!localQuizStarted ? (
        <>
          {officialStartBlockedReason ? (
            <p className="text-sm text-amber-800 dark:text-amber-400">
              {officialStartBlockedReason}
            </p>
          ) : null}
          <Button
            type="button"
            className="w-full"
            disabled={hostBusy || disabled || Boolean(officialStartBlockedReason)}
            onClick={() => {
              if (officialStartBlockedReason) return;
              if (canStartWithThisSong) {
                setStartQuizConfirmOpen(true);
                return;
              }
              void onStartQuizNow(false);
            }}
          >
            Start Quiz Now
          </Button>
        </>
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

      <div className="space-y-3">
        <div className="space-y-2">
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={!canCloseThisRound}
            onClick={() => {
              void onCloseThisRound();
            }}
          >
            Close this round
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Reveal results and score this round.
          </p>
        </div>

        <div className="rounded-xl border border-border/50 bg-muted/25 p-3 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Other actions
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-full text-destructive hover:text-destructive"
            disabled={!canSkipThisSong}
            onClick={() => setSkipConfirmOpen(true)}
          >
            Skip this song
          </Button>
          <div className="grid grid-cols-2 gap-2">
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
              {autoInterrupted ? "Resume" : "Pause"}
            </Button>
            {canFinish && finishAction ? (
              <Button
                type="button"
                variant="outline"
                className="w-full text-destructive hover:text-destructive"
                disabled={finishPending || disabled}
                onClick={() => setEndQuizConfirmOpen(true)}
              >
                {finishPending ? "Ending…" : "End quiz"}
              </Button>
            ) : (
              <span aria-hidden className="block" />
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={hostBusy || autoInterrupted || atRoundLimit}
            onClick={() => {
              void onPlayNext();
            }}
          >
            Play next
          </Button>
        </div>
      </div>

      <LiveHostScreenLockField id="spotify-screen-lock" disabled={disabled} />

      <LiveQuizInactivityNotice
        autoInterrupted={autoInterrupted}
        autoEmptyStreak={autoEmptyStreak}
        emptyStreakThreshold={emptyStreakThreshold}
        notifySignal={inactivityNotifySignal}
      />

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

      <StartQuizNowDialog
        open={startQuizConfirmOpen}
        onOpenChange={setStartQuizConfirmOpen}
        pending={busy}
        hasActiveRound={hasActiveRound}
        canStartWithThisSong={canStartWithThisSong}
        onChoose={(includeCurrentSong) => {
          void onStartQuizNow(includeCurrentSong);
        }}
      />

      <Dialog open={skipConfirmOpen} onOpenChange={setSkipConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Skip this song?</DialogTitle>
            <DialogDescription>
              All guesses for this round are discarded. The round will not be scored
              and the same round number continues with the next song.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setSkipConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!canSkipThisSong || busy}
              onClick={() => {
                setSkipConfirmOpen(false);
                void onSkipThisSong();
              }}
            >
              Yes, skip this song
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
