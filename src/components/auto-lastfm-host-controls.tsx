"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  interruptAutoSpotifyQuizAction,
  resumeAutoSpotifyQuizAction,
  syncLastfmLiveRoundAction,
  updateLastfmUsernameAction,
} from "@/app/actions/quiz-round";
import { QuizPlanLimitPrompt } from "@/components/quiz-plan-limit-prompt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isQuizPlanLimitError } from "@/lib/quiz-plan-limits";
import type { PlanId } from "@/lib/quiz-plans";

const POLL_MS = 5000;
const DEBOUNCE_MS = 5000;
/**
 * Only for true stop / silence (no next track yet).
 * Song changes do NOT wait on this — a new trackKey closes + opens immediately.
 * Last.fm often drops nowplaying for 1 poll mid-song; ignoring a single miss
 * prevents close→reopen of the same song (blips almost never show a different track).
 */
const NOT_PLAYING_STREAK_TO_CLOSE = 2;
/** Ignore one-off Last.fm / network blips before showing a red error. */
const ERROR_STREAK_TO_SHOW = 2;

type AutoLastfmHostControlsProps = {
  quizId: string;
  joinCode: string;
  lastfmUsername: string;
  disabled?: boolean;
  autoInterrupted?: boolean;
  emptyStreakThreshold?: number;
  planId?: PlanId;
  isAnonymous?: boolean;
  unlocked?: boolean;
  roundLimit?: number | null;
  currentRoundNumber?: number;
};

type NowPlayingTrack = {
  trackKey: string;
  title: string;
  artist: string;
  albumArtUrl?: string | null;
};

function isSoftSyncError(message: string): boolean {
  // Races from overlapping close/open or a refresh mid-action — not actionable.
  return (
    /already active/i.test(message) ||
    /not open for guesses/i.test(message) ||
    /abort/i.test(message) ||
    /fetch failed/i.test(message) ||
    /network/i.test(message) ||
    /unexpected response/i.test(message) ||
    /failed to find/i.test(message) ||
    /operation(s)? failed/i.test(message)
  );
}

/** Host Live Spotify via Last.fm: poll now-playing and open/close rounds with a 5s debounce. */
export function AutoLastfmHostControls({
  quizId,
  joinCode,
  lastfmUsername: initialUsername,
  disabled = false,
  autoInterrupted = false,
  emptyStreakThreshold = 3,
  planId = "free",
  isAnonymous = false,
  unlocked = false,
  roundLimit = null,
  currentRoundNumber = 0,
}: AutoLastfmHostControlsProps) {
  const router = useRouter();
  const [username, setUsername] = useState(initialUsername);
  const [usernameDraft, setUsernameDraft] = useState(initialUsername);
  const [status, setStatus] = useState("Listening for Spotify via Last.fm…");
  const [nowPlaying, setNowPlaying] = useState<NowPlayingTrack | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planLimitError, setPlanLimitError] = useState<string | null>(null);

  const pendingKeyRef = useRef<string | null>(null);
  const lastKeyRef = useRef<string | null>(null);
  /** After "Close this round": keep listening but do not reopen until the song changes. */
  const deferredKeyRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const wasPlayingRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const pollInFlightRef = useRef(false);
  const notPlayingStreakRef = useRef(0);
  const errorStreakRef = useRef(0);
  const autoInterruptedRef = useRef(autoInterrupted);
  const emptyStreakRef = useRef(emptyStreakThreshold);

  useEffect(() => {
    setUsername(initialUsername);
    setUsernameDraft(initialUsername);
  }, [initialUsername]);

  useEffect(() => {
    autoInterruptedRef.current = autoInterrupted;
  }, [autoInterrupted]);

  useEffect(() => {
    emptyStreakRef.current = emptyStreakThreshold;
  }, [emptyStreakThreshold]);

  const clearDebounce = useCallback(() => {
    if (debounceTimerRef.current != null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = null;
  }, []);

  const trackLabel = useCallback((track: NowPlayingTrack) => {
    return `${track.title} — ${track.artist}`;
  }, []);

  const reportError = useCallback((message: string | null) => {
    if (!message) {
      errorStreakRef.current = 0;
      setError(null);
      return;
    }
    if (isQuizPlanLimitError(message)) {
      setPlanLimitError(message);
      setError(null);
      errorStreakRef.current = 0;
      setStatus("Round limit reached — unlock, change plan, or finish the quiz.");
      return;
    }
    if (isSoftSyncError(message)) {
      return;
    }
    errorStreakRef.current += 1;
    if (errorStreakRef.current >= ERROR_STREAK_TO_SHOW) {
      setError(message);
    }
  }, []);

  const atRoundLimit =
    Boolean(planLimitError) ||
    (roundLimit != null && currentRoundNumber >= roundLimit);

  const runSync = useCallback(
    async (opts?: {
      forceClose?: boolean;
      openNewRound?: boolean;
      /** Manual host action: wait out an in-flight poll sync, then always run. */
      manual?: boolean;
      nowPlaying?:
        | { playing: false }
        | { playing: true; title: string; artist: string; albumArtUrl?: string | null };
    }) => {
      if (syncInFlightRef.current) {
        if (!opts?.manual) return null;
        for (let i = 0; i < 40 && syncInFlightRef.current; i += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 50));
        }
        if (syncInFlightRef.current) return null;
      }
      syncInFlightRef.current = true;
      setBusy(true);
      try {
        const result = await syncLastfmLiveRoundAction(quizId, joinCode, {
          forceClose: opts?.forceClose,
          openNewRound: opts?.openNewRound,
          nowPlaying: opts?.nowPlaying,
        });
        if (result.error) {
          reportError(result.error);
          return result;
        }
        reportError(null);
        if (result.interrupted) {
          clearDebounce();
          pendingKeyRef.current = null;
          const key = lastKeyRef.current;
          if (key) deferredKeyRef.current = key;
          autoInterruptedRef.current = true;
          setStatus(
            `Interrupted — ${emptyStreakRef.current} songs in a row had no guesses.`,
          );
          router.refresh();
          return result;
        }
        if (result.startedRound && result.trackTitle) {
          setStatus(
            `Round open: ${result.trackTitle} — ${result.trackArtist ?? ""}`,
          );
          router.refresh();
        } else if (result.closedRound && result.nothingPlaying) {
          setStatus("Round closed — nothing playing on Last.fm");
          router.refresh();
        } else if (result.closedRound) {
          setStatus("Round closed");
          router.refresh();
        }
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Could not sync with Last.fm.";
        reportError(message);
        return null;
      } finally {
        syncInFlightRef.current = false;
        setBusy(false);
      }
    },
    [clearDebounce, joinCode, quizId, reportError, router],
  );

  // Keep latest runSync in a ref so the poll interval stays stable.
  const runSyncRef = useRef(runSync);
  useEffect(() => {
    runSyncRef.current = runSync;
  }, [runSync]);

  const scheduleOpen = useCallback(
    (track: NowPlayingTrack) => {
      if (deferredKeyRef.current === track.trackKey) {
        setStatus(`Waiting for next song (ended ${trackLabel(track)})`);
        return;
      }
      if (
        pendingKeyRef.current === track.trackKey &&
        debounceTimerRef.current != null
      ) {
        return;
      }

      clearDebounce();
      pendingKeyRef.current = track.trackKey;
      setStatus(`Detected: ${trackLabel(track)} — opening in 5s…`);
      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null;
        void (async () => {
          try {
            // Host may have ended/paused while we were waiting.
            if (
              autoInterruptedRef.current ||
              deferredKeyRef.current === track.trackKey
            ) {
              pendingKeyRef.current = null;
              return;
            }
            // Re-check Last.fm so we do not open if the host already skipped again.
            const response = await fetch(
              `/api/lastfm/now-playing?user=${encodeURIComponent(username.trim())}`,
              { cache: "no-store" },
            );
            const data = (await response.json()) as {
              ok?: boolean;
              playing?: boolean;
              track?: NowPlayingTrack;
            };
            if (
              autoInterruptedRef.current ||
              deferredKeyRef.current === track.trackKey
            ) {
              pendingKeyRef.current = null;
              return;
            }
            const stillSame =
              response.ok &&
              data.ok !== false &&
              data.playing &&
              data.track?.trackKey === track.trackKey;

            if (!stillSame) {
              // Last.fm blip on the same expected song — debounce again instead of aborting.
              if (lastKeyRef.current === track.trackKey) {
                pendingKeyRef.current = null;
                scheduleOpenRef.current(track);
                return;
              }
              setStatus("Song changed again — waiting…");
              pendingKeyRef.current = null;
              return;
            }
            pendingKeyRef.current = null;
            const confirmed = data.track ?? track;
            await runSyncRef.current({
              openNewRound: true,
              nowPlaying: {
                playing: true,
                title: confirmed.title,
                artist: confirmed.artist,
                albumArtUrl: confirmed.albumArtUrl ?? null,
              },
            });
          } catch {
            pendingKeyRef.current = null;
            reportError("Could not start the round from Last.fm.");
          }
        })();
      }, DEBOUNCE_MS);
    },
    [clearDebounce, reportError, trackLabel, username],
  );

  const scheduleOpenRef = useRef(scheduleOpen);
  useEffect(() => {
    scheduleOpenRef.current = scheduleOpen;
  }, [scheduleOpen]);

  useEffect(() => {
    if (autoInterrupted) {
      clearDebounce();
      pendingKeyRef.current = null;
    }
  }, [autoInterrupted, clearDebounce]);

  useEffect(() => {
    if (disabled || atRoundLimit || !username.trim()) {
      clearDebounce();
      return;
    }

    let cancelled = false;

    const poll = async () => {
      if (cancelled || document.visibilityState === "hidden") return;
      // Overlapping polls caused close/open races and flashing errors.
      if (pollInFlightRef.current || syncInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const response = await fetch(
          `/api/lastfm/now-playing?user=${encodeURIComponent(username.trim())}`,
          { cache: "no-store" },
        );
        const data = (await response.json()) as {
          ok?: boolean;
          playing?: boolean;
          track?: NowPlayingTrack;
          message?: string;
          code?: string;
        };
        if (cancelled) return;

        if (!response.ok || data.ok === false) {
          reportError(data.message ?? "Could not read Last.fm.");
          return;
        }

        reportError(null);

        if (!data.playing || !data.track) {
          notPlayingStreakRef.current += 1;
          // Mid-song Last.fm blip: keep lastKey so when the same track returns we
          // do not treat it as a new song. A real next song arrives as playing+new
          // key and is handled immediately below — no delay from this streak.
          if (notPlayingStreakRef.current < NOT_PLAYING_STREAK_TO_CLOSE) {
            return;
          }
          // Playback actually stopped (no next track reported).
          setNowPlaying(null);
          if (wasPlayingRef.current) {
            wasPlayingRef.current = false;
            // Keep deferred skip-lock across silence (pause / end-this-round).
            // Clearing it here would re-open the interrupted song on resume.
            if (deferredKeyRef.current == null) {
              lastKeyRef.current = null;
            }
            clearDebounce();
            pendingKeyRef.current = null;
            if (!autoInterruptedRef.current) {
              setStatus("Track ended — closing round…");
              await runSyncRef.current({
                forceClose: true,
                openNewRound: false,
                nowPlaying: { playing: false },
              });
            }
          } else if (!autoInterruptedRef.current) {
            setStatus("Nothing playing — start a track in Spotify");
          }
          return;
        }

        notPlayingStreakRef.current = 0;

        const track = data.track;
        setNowPlaying((prev) =>
          prev?.trackKey === track.trackKey &&
          prev.title === track.title &&
          prev.artist === track.artist
            ? prev
            : track,
        );

        if (autoInterruptedRef.current) {
          wasPlayingRef.current = true;
          setStatus(`Paused · Now: ${track.title} — ${track.artist}`);
          return;
        }

        // New song → close previous round immediately, then debounce-open.
        // (Same-song Last.fm blips never reach here as a "change".)
        const changed = lastKeyRef.current !== track.trackKey;
        if (changed) {
          const previous = lastKeyRef.current;
          lastKeyRef.current = track.trackKey;
          wasPlayingRef.current = true;
          clearDebounce();
          pendingKeyRef.current = null;
          // Keep skip-lock if this is still the interrupted/ended song.
          if (deferredKeyRef.current === track.trackKey) {
            setStatus(
              `Listening — ${trackLabel(track)} (round closed, next song continues automatically)`,
            );
            return;
          }
          // Advancing past the skipped song — clear the lock.
          deferredKeyRef.current = null;
          if (previous) {
            setStatus("Song changed — revealing previous round…");
            await runSyncRef.current({ forceClose: true, openNewRound: false });
          }
          scheduleOpenRef.current(track);
          return;
        }

        wasPlayingRef.current = true;
        if (deferredKeyRef.current === track.trackKey) {
          setStatus(
            `Listening — ${trackLabel(track)} (round closed, next song continues automatically)`,
          );
          return;
        }
        if (pendingKeyRef.current == null) {
          setStatus(`Listening — ${trackLabel(track)}`);
        }
      } catch {
        if (!cancelled) reportError("Could not reach Last.fm.");
      } finally {
        pollInFlightRef.current = false;
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
    // Stable poll loop — callbacks via refs. Do not depend on runSync/scheduleOpen.
  }, [atRoundLimit, clearDebounce, disabled, reportError, trackLabel, username]);

  /** Lock the current track so polls do not reopen it after End / Pause / Resume. */
  function deferCurrentTrack() {
    const key = nowPlaying?.trackKey ?? lastKeyRef.current;
    if (!key) return null;
    deferredKeyRef.current = key;
    lastKeyRef.current = key;
    return key;
  }

  async function onCloseThisRound() {
    clearDebounce();
    pendingKeyRef.current = null;
    deferCurrentTrack();
    setBusy(true);
    reportError(null);
    try {
      setStatus("Closing round…");
      await runSync({ forceClose: true, openNewRound: false, manual: true });
      if (nowPlaying) {
        setStatus(
          `Round closed — ${trackLabel(nowPlaying)} (next song continues automatically)`,
        );
      } else {
        setStatus("Round closed — results are on the board");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onInterruptOrContinue() {
    setBusy(true);
    reportError(null);
    try {
      if (autoInterrupted) {
        // Resume: keep the song locked at Pause time. If Spotify already moved
        // on, open the current track; only skip the interrupted one.
        clearDebounce();
        pendingKeyRef.current = null;
        notPlayingStreakRef.current = 0;
        const skippedKey = deferredKeyRef.current;
        const current = nowPlaying;
        const result = await resumeAutoSpotifyQuizAction(quizId, joinCode);
        if (result.error) {
          reportError(result.error);
          return;
        }
        autoInterruptedRef.current = false;

        if (current && current.trackKey !== skippedKey) {
          deferredKeyRef.current = null;
          lastKeyRef.current = current.trackKey;
          wasPlayingRef.current = true;
          scheduleOpenRef.current(current);
          router.refresh();
          return;
        }

        if (current) {
          lastKeyRef.current = current.trackKey;
          deferredKeyRef.current = current.trackKey;
          setStatus(
            `Resumed — waiting for next song (skipped ${trackLabel(current)})`,
          );
        } else {
          setStatus("Resumed — listening for the next song");
        }
        router.refresh();
        return;
      }

      // Pause: lock the song being interrupted (not whatever plays later).
      clearDebounce();
      pendingKeyRef.current = null;
      deferCurrentTrack();
      autoInterruptedRef.current = true;
      setStatus("Paused — closing round…");
      const result = await interruptAutoSpotifyQuizAction(quizId, joinCode);
      if (result.error) {
        autoInterruptedRef.current = false;
        reportError(result.error);
        return;
      }
      setStatus("Paused — press Resume to continue live mode");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onSaveUsername() {
    setBusy(true);
    reportError(null);
    try {
      const result = await updateLastfmUsernameAction(
        quizId,
        joinCode,
        usernameDraft,
      );
      if (result.error) {
        reportError(result.error);
        return;
      }
      setUsername(usernameDraft.trim().replace(/^@/, ""));
      lastKeyRef.current = null;
      deferredKeyRef.current = null;
      notPlayingStreakRef.current = 0;
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!username.trim()) {
    return (
      <section className="space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
        <h2 className="text-lg font-semibold">Live Spotify (Last.fm)</h2>
        <p className="text-sm text-muted-foreground">
          Enter the Last.fm username linked to the Spotify account that is playing
          music.
        </p>
        <div className="space-y-2">
          <Label htmlFor="lastfm-username-host">Last.fm username</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="lastfm-username-host"
              value={usernameDraft}
              onChange={(event) => setUsernameDraft(event.target.value)}
              placeholder="your_lastfm_name"
              className="max-w-xs"
              maxLength={64}
            />
            <Button
              type="button"
              disabled={busy || !usernameDraft.trim()}
              onClick={() => {
                void onSaveUsername();
              }}
            >
              Save
            </Button>
          </div>
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
      <div>
        <h2 className="text-lg font-semibold">Live Spotify (Last.fm)</h2>
        <p className="text-sm text-muted-foreground">{status}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Following @{username} · skip songs in Spotify · rounds open after 5s
        </p>
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
