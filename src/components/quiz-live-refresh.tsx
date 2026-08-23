"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { fetchQuizPlaySnapshotAction } from "@/app/actions/quiz-round";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_MAX_CURATED_TRACKS } from "@/lib/quiz-plans";
import type {
  CuratedTrackRow,
  GuessRow,
  LeaderboardRow,
  RoundRow,
} from "@/lib/quizzes/play-state";

type QuizLiveRefreshProps = {
  quizId: string;
  joinCode: string;
  /** Debounce bursty DB events before snapshot sync / RSC refresh. */
  debounceMs?: number;
};

export type QuizGuessLivePatch = {
  roundId: string;
  userId: string;
  guessedYear: number;
  displayName?: string;
};

export type QuizPlaySnapshot = {
  currentRoundNumber: number;
  tracks: CuratedTrackRow[];
  activeRound: RoundRow | null;
  resultRound: RoundRow | null;
  roundGuesses: GuessRow[];
  myGuessYear: number | null;
  leaderboard: LeaderboardRow[];
  memberCount: number;
  quizStatus: string;
  maxCuratedTracks: number | null;
};

export type QuizPlayLivePatch =
  | { type: "replace"; snapshot: QuizPlaySnapshot }
  | { type: "refresh" };

export type QuizResyncPayload = {
  t: number;
  guess?: QuizGuessLivePatch;
};

export const QUIZ_GUESS_LIVE_EVENT = "beatage:quiz-guess-live";

type PlayListener = (patch: QuizPlayLivePatch) => void;
type GuessListener = (patch: QuizGuessLivePatch) => void;

const playListeners = new Map<string, Set<PlayListener>>();
const guessListeners = new Map<string, Set<GuessListener>>();

function quizSyncChannelName(quizId: string) {
  return `quiz-sync:${quizId}`;
}

function emitPlayPatch(quizId: string, patch: QuizPlayLivePatch) {
  const listeners = playListeners.get(quizId);
  if (!listeners) return;
  for (const listener of listeners) listener(patch);
}

function emitGuessPatch(quizId: string, patch: QuizGuessLivePatch) {
  const listeners = guessListeners.get(quizId);
  if (!listeners) return;
  for (const listener of listeners) listener(patch);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(QUIZ_GUESS_LIVE_EVENT, { detail: patch }));
  }
}

export function subscribeQuizPlay(
  quizId: string,
  listener: PlayListener,
): () => void {
  let set = playListeners.get(quizId);
  if (!set) {
    set = new Set();
    playListeners.set(quizId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) playListeners.delete(quizId);
  };
}

export function subscribeQuizGuesses(
  quizId: string,
  listener: GuessListener,
): () => void {
  let set = guessListeners.get(quizId);
  if (!set) {
    set = new Set();
    guessListeners.set(quizId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) guessListeners.delete(quizId);
  };
}

async function fetchQuizPlaySnapshot(
  quizId: string,
  joinCode: string,
): Promise<QuizPlaySnapshot | null> {
  const state = await fetchQuizPlaySnapshotAction(quizId, joinCode);
  if (!state) return null;
  return {
    currentRoundNumber: state.currentRoundNumber,
    tracks: state.tracks,
    activeRound: state.activeRound,
    resultRound: state.resultRound,
    roundGuesses: state.roundGuesses,
    myGuessYear: state.myGuessYear,
    leaderboard: state.leaderboard,
    memberCount: state.memberCount ?? 0,
    quizStatus: state.quizStatus ?? "open",
    maxCuratedTracks:
      state.maxCuratedTracks === undefined
        ? DEFAULT_MAX_CURATED_TRACKS
        : state.maxCuratedTracks,
  };
}

function snapshotFingerprint(snapshot: QuizPlaySnapshot): string {
  return [
    snapshot.quizStatus,
    snapshot.maxCuratedTracks ?? "inf",
    snapshot.currentRoundNumber,
    snapshot.activeRound?.id ?? "",
    snapshot.activeRound?.status ?? "",
    snapshot.resultRound?.id ?? "",
    snapshot.resultRound?.status ?? "",
    snapshot.myGuessYear ?? "",
    snapshot.memberCount,
    snapshot.roundGuesses
      .map((g) => `${g.user_id}:${g.guessed_year}:${g.points_total}`)
      .join(","),
    snapshot.leaderboard.map((r) => `${r.user_id}:${r.total_points}`).join(","),
    snapshot.tracks.map((t) => t.id).join(","),
  ].join("|");
}

/**
 * Notify all quiz tabs to re-fetch snapshot immediately (Realtime Broadcast).
 * Same pattern as broadcastContestResync — short-lived channel on the shared topic.
 * Also applies a local client snapshot (broadcast self:false would skip the sender).
 */
export async function broadcastQuizResync(
  quizId: string,
  joinCode: string,
  extra?: { guess?: QuizGuessLivePatch },
): Promise<void> {
  const supabase = createClient();
  const topic = quizSyncChannelName(quizId);
  const payload: QuizResyncPayload = { t: Date.now(), guess: extra?.guess };

  // Local optimistic guess patch (host list) before wire round-trip.
  if (payload.guess) {
    emitGuessPatch(quizId, payload.guess);
  }

  // Sender tab: apply snapshot now (MyContest relies on postgres_changes for this;
  // quiz play must not wait on RSC / self:false broadcast).
  try {
    const snapshot = await fetchQuizPlaySnapshot(quizId, joinCode);
    if (snapshot) {
      emitPlayPatch(quizId, { type: "replace", snapshot });
    }
  } catch {
    // Best-effort — peers still get broadcast sync.
  }

  async function sendOnce(): Promise<boolean> {
    const channel = supabase.channel(topic, {
      config: { broadcast: { ack: true, self: false } },
    });

    try {
      const subscribed = await new Promise<boolean>((resolve) => {
        const timeout = window.setTimeout(() => resolve(false), 2500);
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            window.clearTimeout(timeout);
            resolve(true);
            return;
          }
          if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            window.clearTimeout(timeout);
            resolve(false);
          }
        });
      });

      if (!subscribed) {
        void supabase.removeChannel(channel);
        return false;
      }

      const result = await channel.send({
        type: "broadcast",
        event: "resync",
        payload,
      });

      window.setTimeout(() => {
        void supabase.removeChannel(channel);
      }, 750);

      return result === "ok";
    } catch {
      void supabase.removeChannel(channel);
      return false;
    }
  }

  const first = await sendOnce();
  if (!first) {
    await sendOnce();
  }
}

/**
 * Event-driven quiz sync (MyContest ContestLiveRefresh pattern):
 * - server snapshot fetch + emit to UI subscribers (do not rely on RSC alone)
 * - broadcast "resync" after actions
 * - postgres_changes when published
 * - visibility / online re-sync
 * - no continuous polling
 */
export function QuizLiveRefresh({
  quizId,
  joinCode,
  debounceMs = 150,
}: QuizLiveRefreshProps) {
  const router = useRouter();
  const timerRef = useRef<number | null>(null);
  const reconcileTimerRef = useRef<number | null>(null);
  const lastFpRef = useRef<string | null>(null);
  const syncInFlightRef = useRef(false);
  const syncAgainRef = useRef(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let retryTimer: number | null = null;
    let retries = 0;

    function scheduleRefresh(immediate = false) {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
      }
      const run = () => {
        emitPlayPatch(quizId, { type: "refresh" });
        router.refresh();
      };
      if (immediate) {
        run();
        return;
      }
      timerRef.current = window.setTimeout(run, debounceMs);
    }

    function scheduleReconcile(delayMs = 400) {
      if (reconcileTimerRef.current != null) {
        window.clearTimeout(reconcileTimerRef.current);
      }
      reconcileTimerRef.current = window.setTimeout(() => {
        reconcileTimerRef.current = null;
        void syncFromServer(true);
      }, delayMs);
    }

    async function syncFromServer(refreshOnChange: boolean) {
      if (cancelled) return;
      if (syncInFlightRef.current) {
        syncAgainRef.current = true;
        return;
      }
      syncInFlightRef.current = true;
      try {
        do {
          syncAgainRef.current = false;
          const snapshot = await fetchQuizPlaySnapshot(quizId, joinCode);
          if (cancelled || !snapshot) continue;

          const fingerprint = snapshotFingerprint(snapshot);
          const changed = fingerprint !== lastFpRef.current;
          if (changed) {
            lastFpRef.current = fingerprint;
            emitPlayPatch(quizId, { type: "replace", snapshot });
            if (refreshOnChange) {
              scheduleRefresh(true);
            }
          }
        } while (!cancelled && syncAgainRef.current);
      } finally {
        syncInFlightRef.current = false;
      }
    }

    function onGenericChange() {
      scheduleReconcile(300);
    }

    function onGuessChange(payload: {
      new?: Record<string, unknown> | null;
    }) {
      const row = payload.new ?? null;
      if (
        row &&
        typeof row.round_id === "string" &&
        typeof row.user_id === "string" &&
        typeof row.guessed_year === "number"
      ) {
        emitGuessPatch(quizId, {
          roundId: row.round_id,
          userId: row.user_id,
          guessedYear: row.guessed_year,
        });
      }
      scheduleReconcile(200);
    }

    async function syncRealtimeAuth(accessToken: string | undefined | null) {
      await supabase.realtime.setAuth(accessToken ?? null);
    }

    function bindChannel() {
      if (cancelled) return;
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }

      channel = supabase
        .channel(quizSyncChannelName(quizId), {
          config: { broadcast: { self: false } },
        })
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "beatage_quizzes",
            filter: `id=eq.${quizId}`,
          },
          onGenericChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "beatage_rounds",
            filter: `quiz_id=eq.${quizId}`,
          },
          onGenericChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "beatage_curated_tracks",
            filter: `quiz_id=eq.${quizId}`,
          },
          onGenericChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "beatage_quiz_members",
            filter: `quiz_id=eq.${quizId}`,
          },
          onGenericChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "beatage_guesses",
          },
          (payload) => onGuessChange(payload as { new?: Record<string, unknown> | null }),
        )
        .on("broadcast", { event: "resync" }, ({ payload }) => {
          const body = payload as QuizResyncPayload | null;
          if (body?.guess) {
            emitGuessPatch(quizId, body.guess);
          }
          void syncFromServer(true);
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            retries = 0;
            void syncFromServer(true);
            return;
          }
          if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            const delay = Math.min(15_000, 1000 * 2 ** Math.min(retries, 4));
            retries += 1;
            if (retryTimer != null) window.clearTimeout(retryTimer);
            retryTimer = window.setTimeout(() => {
              if (!cancelled) bindChannel();
            }, delay);
          }
        });
    }

    function onVisibilityOrOnline() {
      if (document.visibilityState !== "visible") return;
      void syncFromServer(true);
    }

    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void (async () => {
        await syncRealtimeAuth(session?.access_token);
        if (!cancelled && !channel) {
          bindChannel();
        }
      })();
    });

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      await syncRealtimeAuth(session?.access_token);
      if (!cancelled) {
        bindChannel();
        void syncFromServer(false);
      }
    })();

    document.addEventListener("visibilitychange", onVisibilityOrOnline);
    window.addEventListener("online", onVisibilityOrOnline);
    window.addEventListener("focus", onVisibilityOrOnline);
    window.addEventListener("pageshow", onVisibilityOrOnline);

    return () => {
      cancelled = true;
      authSubscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisibilityOrOnline);
      window.removeEventListener("online", onVisibilityOrOnline);
      window.removeEventListener("focus", onVisibilityOrOnline);
      window.removeEventListener("pageshow", onVisibilityOrOnline);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      if (reconcileTimerRef.current != null) {
        window.clearTimeout(reconcileTimerRef.current);
      }
      if (retryTimer != null) window.clearTimeout(retryTimer);
      if (channel) void supabase.removeChannel(channel);
      channel = null;
    };
  }, [quizId, joinCode, debounceMs, router]);

  return null;
}
