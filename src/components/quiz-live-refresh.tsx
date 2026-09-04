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
  PastRoundRow,
  RoundRow,
} from "@/lib/quizzes/play-state";
import type { BeatageQuizSettings } from "@/lib/quiz-settings";
import { DEFAULT_QUIZ_SETTINGS } from "@/lib/quiz-settings";
import type {
  QuizRosterMember,
  QuizTeamInfo,
  TeamRoundGroup,
} from "@/lib/quiz-teams";

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
  /** Total curated tracks (use when tracks[] is omitted for live / non-host). */
  trackCount: number;
  activeRound: RoundRow | null;
  resultRound: RoundRow | null;
  pastRounds: PastRoundRow[];
  roundGuesses: GuessRow[];
  myGuessYear: number | null;
  myGuessWasNumberOne: boolean | null;
  leaderboard: LeaderboardRow[];
  memberCount: number;
  roster: QuizRosterMember[];
  teams: QuizTeamInfo[];
  teamsLocked: boolean;
  resultTeamGroups: TeamRoundGroup[];
  quizStatus: string;
  maxCuratedTracks: number | null;
  settings: BeatageQuizSettings;
  autoInterrupted: boolean;
  autoEmptyStreak: number;
  /** False while live quiz is still in pre-round warm-up. */
  quizStarted: boolean;
  leaderboardRevealStep: number;
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
    trackCount: state.trackCount ?? state.tracks?.length ?? 0,
    activeRound: state.activeRound,
    resultRound: state.resultRound,
    pastRounds: state.pastRounds ?? [],
    roundGuesses: state.roundGuesses,
    myGuessYear: state.myGuessYear,
    myGuessWasNumberOne: state.myGuessWasNumberOne ?? null,
    leaderboard: state.leaderboard,
    memberCount: state.memberCount ?? 0,
    roster: state.roster ?? [],
    teams: state.teams ?? [],
    teamsLocked: Boolean(state.teamsLocked),
    resultTeamGroups: state.resultTeamGroups ?? [],
    quizStatus: state.quizStatus ?? "open",
    maxCuratedTracks:
      state.maxCuratedTracks === undefined
        ? DEFAULT_MAX_CURATED_TRACKS
        : state.maxCuratedTracks,
    settings: state.settings ?? { ...DEFAULT_QUIZ_SETTINGS },
    autoInterrupted: Boolean(state.autoInterrupted),
    autoEmptyStreak: state.autoEmptyStreak ?? 0,
    quizStarted: state.quizStarted !== false,
    leaderboardRevealStep: state.leaderboardRevealStep ?? 0,
  };
}

function snapshotFingerprint(snapshot: QuizPlaySnapshot): string {
  return [
    snapshotStructuralFingerprint(snapshot),
    String(snapshot.leaderboardRevealStep ?? 0),
  ].join("|");
}

/** Fingerprint without presentation-only fields (leaderboard reveal step). */
function snapshotStructuralFingerprint(snapshot: QuizPlaySnapshot): string {
  return [
    snapshot.quizStatus,
    snapshot.maxCuratedTracks ?? "inf",
    snapshot.currentRoundNumber,
    snapshot.quizStarted ? "1" : "0",
    snapshot.activeRound?.id ?? "",
    snapshot.activeRound?.status ?? "",
    snapshot.activeRound?.is_pre_round ? "pre" : "off",
    snapshot.resultRound?.id ?? "",
    snapshot.resultRound?.status ?? "",
    snapshot.pastRounds
      .map(
        (r) =>
          `${r.id}:${r.my_points ?? ""}:${r.lateJoinAssigned?.assignedPoints ?? ""}`,
      )
      .join(","),
    snapshot.myGuessYear ?? "",
    snapshot.myGuessWasNumberOne === true
      ? "1"
      : snapshot.myGuessWasNumberOne === false
        ? "0"
        : "",
    snapshot.memberCount,
    snapshot.roster
      .map((member) => `${member.user_id}:${member.display_name}:${member.role}`)
      .join(","),
    (snapshot.teams ?? []).map((t) => `${t.id}:${t.member_user_ids.join(".")}`).join(","),
    snapshot.teamsLocked ? "1" : "0",
    (snapshot.resultTeamGroups ?? [])
      .map((g) => `${g.team_id}:${g.average_points}:${g.aggregateOnly ? "a" : "f"}`)
      .join(","),
    snapshot.roundGuesses
      .map(
        (g) =>
          `${g.user_id}:${g.submitted_at}:${g.guessed_year}:${g.guessed_was_number_one}:${g.points_total}`,
      )
      .join(","),
    snapshot.leaderboard
      .map((r) => `${r.user_id}:${r.total_points}:${r.last_round_points}`)
      .join(","),
    snapshot.trackCount,
    snapshot.tracks.map((t) => t.id).join(","),
    snapshot.autoInterrupted ? "1" : "0",
    String(snapshot.autoEmptyStreak ?? 0),
    snapshot.settings.showTitleArtist ? "1" : "0",
    snapshot.settings.showCorrectAnswer ? "1" : "0",
    snapshot.settings.showOverallResults ? "1" : "0",
    snapshot.settings.showResultDetails ? "1" : "0",
    snapshot.settings.showOthersInPastResults ? "1" : "0",
    snapshot.settings.teamsEnabled ? "1" : "0",
    snapshot.settings.overallReveal,
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
  // Guess-only resync: patch the host list locally. Skip the full PostgREST snapshot.
  if (payload.guess) {
    emitGuessPatch(quizId, payload.guess);
  } else {
    try {
      const snapshot = await fetchQuizPlaySnapshot(quizId, joinCode);
      if (snapshot) {
        emitPlayPatch(quizId, { type: "replace", snapshot });
      }
    } catch {
      // Best-effort — peers still get broadcast sync.
    }
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

    function scheduleRosterRefresh(immediate = false) {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
      }
      const run = () => {
        emitPlayPatch(quizId, { type: "refresh" });
        // Roster / header only — play UI is driven by the snapshot replace path.
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
        void syncFromServer();
      }, delayMs);
    }

    async function syncFromServer() {
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
            // Do not router.refresh() here: play panels / badges update from
            // the snapshot. RSC refresh is reserved for roster (members) below.
          }
        } while (!cancelled && syncAgainRef.current);
      } finally {
        syncInFlightRef.current = false;
      }
    }

    function onPlayChange() {
      scheduleReconcile(300);
    }

    function onMemberChange() {
      scheduleReconcile(300);
      scheduleRosterRefresh();
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
      // Do not snapshot/router.refresh() here: on Vercel that aborts the in-flight
      // submitGuessAction and leaves the button stuck on "Saving…".
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
          onPlayChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "beatage_rounds",
            filter: `quiz_id=eq.${quizId}`,
          },
          onPlayChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "beatage_curated_tracks",
            filter: `quiz_id=eq.${quizId}`,
          },
          onPlayChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "beatage_quiz_members",
            filter: `quiz_id=eq.${quizId}`,
          },
          onMemberChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "beatage_teams",
            filter: `quiz_id=eq.${quizId}`,
          },
          onMemberChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "beatage_team_members",
            filter: `quiz_id=eq.${quizId}`,
          },
          onMemberChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "beatage_guesses",
            filter: `quiz_id=eq.${quizId}`,
          },
          (payload) => onGuessChange(payload as { new?: Record<string, unknown> | null }),
        )
        .on("broadcast", { event: "resync" }, ({ payload }) => {
          const body = payload as QuizResyncPayload | null;
          if (body?.guess) {
            emitGuessPatch(quizId, body.guess);
            // Guess-only: patch lists locally. A full refresh races the submitter.
            return;
          }
          void syncFromServer();
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            retries = 0;
            void syncFromServer();
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
      void syncFromServer();
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
        void syncFromServer();
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
