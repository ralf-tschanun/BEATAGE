"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type ContestLiveRefreshProps = {
  contestId: string;
  debounceMs?: number;
  /**
   * Optional rare safety-net poll while the tab is visible.
   * 0 = disabled (default). Prefer Realtime + broadcast + visibility sync.
   */
  pollIntervalMs?: number;
  /** When set with ejectIfRemoved, leave the contest page if this user is kicked. */
  currentUserId?: string;
  /**
   * Redirect to home when the current user disappears from contest_members
   * (host remove). Only use on the contest page — not the dashboard.
   */
  ejectIfRemoved?: boolean;
};

export type LiveCandidateRow = {
  id: string;
  title: string;
  artist: string | null;
  url: string | null;
  description: string | null;
  status: string;
  nominator_user_id: string | null;
  created_at?: string;
  display_order?: number | null;
  delete_photo_on_finish?: boolean;
  photo_cleared?: boolean;
  /** ISO timestamp when host revealed this candidate (admin reveal modes). */
  revealed_at?: string | null;
  /** open.spotify.com track URL when resolved for the host. */
  spotify_url?: string | null;
  /** spotify:track:... URI for opening the native app. */
  spotify_uri?: string | null;
  /** Anything contest: question this candidate belongs to. */
  question_id?: string | null;
  /** curated | user — combined contests mark host seeds as curated. */
  nomination_origin?: string | null;
};

export type CandidateLivePatch =
  | { type: "upsert"; row: LiveCandidateRow }
  | { type: "remove"; id: string }
  | { type: "replace"; rows: LiveCandidateRow[] }
  | { type: "refresh" };

export type ContestLiveMeta = {
  status: string;
  votingOpen: boolean;
  nominationsOpen: boolean;
  title: string | null;
  resultsReveal: string | null;
  resultsRevealStep: number;
  resultsPhase: string | null;
  nominatorRevealStep: number;
  votingCloseMode: string | null;
  votingClosesAt: string | null;
  votingReopenedAt: string | null;
  nominationDeadline: string | null;
  nominationsReopenedAt: string | null;
};

export type BallotLivePatch =
  | {
      type: "upsert";
      voterUserId: string;
      updatedAt: string | null;
      ballotCount?: number;
    }
  | { type: "remove"; voterUserId: string }
  | {
      type: "replace";
      voters: Array<{
        voterUserId: string;
        updatedAt: string | null;
        ballotCount?: number;
      }>;
    }
  | { type: "refresh" };

export type LiveMemberRow = {
  id: string;
  userId: string;
  displayName: string;
  role: string;
  joinedAt: string | null;
};

export type MemberLivePatch =
  | { type: "replace"; members: LiveMemberRow[] }
  | { type: "refresh" };

export type BirthdaySubmitLivePatch =
  | { type: "replace"; submittedUserIds: string[] }
  | { type: "refresh" };

type CandidateListener = (patch: CandidateLivePatch) => void;
type ContestMetaListener = (meta: ContestLiveMeta) => void;
type BallotListener = (patch: BallotLivePatch) => void;
type MemberListener = (patch: MemberLivePatch) => void;
type BirthdaySubmitListener = (patch: BirthdaySubmitLivePatch) => void;

const candidateListeners = new Map<string, Set<CandidateListener>>();
const contestMetaListeners = new Map<string, Set<ContestMetaListener>>();
const ballotListeners = new Map<string, Set<BallotListener>>();
const memberListeners = new Map<string, Set<MemberListener>>();
const birthdaySubmitListeners = new Map<string, Set<BirthdaySubmitListener>>();

const CONTEST_META_COLUMNS =
  "status, voting_open, nominations_open, title, results_reveal, results_reveal_step, results_phase, nominator_reveal_step, voting_close_mode, voting_closes_at, voting_reopened_at, nomination_deadline, nominations_reopened_at, last_activity_at";

const CANDIDATE_COLUMNS =
  "id, title, artist, url, description, status, nominator_user_id, created_at, display_order, delete_photo_on_finish, meta, question_id";

function emitCandidatePatch(contestId: string, patch: CandidateLivePatch) {
  const listeners = candidateListeners.get(contestId);
  if (!listeners) return;
  for (const listener of listeners) listener(patch);
}

function emitContestMeta(contestId: string, meta: ContestLiveMeta) {
  const listeners = contestMetaListeners.get(contestId);
  if (!listeners) return;
  for (const listener of listeners) listener(meta);
}

function emitBallotPatch(contestId: string, patch: BallotLivePatch) {
  const listeners = ballotListeners.get(contestId);
  if (!listeners) return;
  for (const listener of listeners) listener(patch);
}

function emitMemberPatch(contestId: string, patch: MemberLivePatch) {
  const listeners = memberListeners.get(contestId);
  if (!listeners) return;
  for (const listener of listeners) listener(patch);
}

function emitBirthdaySubmitPatch(
  contestId: string,
  patch: BirthdaySubmitLivePatch,
) {
  const listeners = birthdaySubmitListeners.get(contestId);
  if (!listeners) return;
  for (const listener of listeners) listener(patch);
}

function subscribeSet<T>(
  map: Map<string, Set<T>>,
  contestId: string,
  listener: T,
) {
  let set = map.get(contestId);
  if (!set) {
    set = new Set();
    map.set(contestId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) map.delete(contestId);
  };
}

export function subscribeContestCandidates(
  contestId: string,
  listener: CandidateListener,
) {
  return subscribeSet(candidateListeners, contestId, listener);
}

export function subscribeContestMeta(
  contestId: string,
  listener: ContestMetaListener,
) {
  return subscribeSet(contestMetaListeners, contestId, listener);
}

export function subscribeContestBallots(
  contestId: string,
  listener: BallotListener,
) {
  return subscribeSet(ballotListeners, contestId, listener);
}

export function subscribeContestMembers(
  contestId: string,
  listener: MemberListener,
) {
  return subscribeSet(memberListeners, contestId, listener);
}

export function subscribeBirthdaySubmits(
  contestId: string,
  listener: BirthdaySubmitListener,
) {
  return subscribeSet(birthdaySubmitListeners, contestId, listener);
}

/** Apply a candidate live patch; returns null when the list should stay unchanged. */
export function applyCandidateLivePatch<T extends { id: string }>(
  prev: T[],
  patch: CandidateLivePatch,
  mapRow: (row: LiveCandidateRow) => T,
  options?: { /** When true, new rows are inserted at the start of the list. */ prependNew?: boolean },
): T[] | null {
  if (patch.type === "refresh") return null;
  if (patch.type === "replace") return patch.rows.map(mapRow);
  if (patch.type === "remove") return prev.filter((row) => row.id !== patch.id);
  const mapped = mapRow(patch.row);
  const index = prev.findIndex((row) => row.id === mapped.id);
  if (index === -1) {
    return options?.prependNew ? [mapped, ...prev] : [...prev, mapped];
  }
  const next = [...prev];
  next[index] = { ...next[index], ...mapped };
  return next;
}

function asCandidateRow(value: Record<string, unknown>): LiveCandidateRow | null {
  if (typeof value.id !== "string" || typeof value.title !== "string") return null;
  const meta =
    value.meta && typeof value.meta === "object"
      ? (value.meta as Record<string, unknown>)
      : {};
  return {
    id: value.id,
    title: value.title,
    artist: typeof value.artist === "string" ? value.artist : null,
    url: typeof value.url === "string" ? value.url : null,
    description: typeof value.description === "string" ? value.description : null,
    status: typeof value.status === "string" ? value.status : "pending",
    nominator_user_id:
      typeof value.nominator_user_id === "string" ? value.nominator_user_id : null,
    created_at: typeof value.created_at === "string" ? value.created_at : undefined,
    display_order:
      typeof value.display_order === "number"
        ? value.display_order
        : value.display_order == null
          ? null
          : Number(value.display_order) || null,
    delete_photo_on_finish: value.delete_photo_on_finish === true,
    photo_cleared:
      typeof meta.photo_cleared_at === "string" ||
      meta.photo_storage_deleted === true ||
      typeof meta.storage_delete_url === "string",
    revealed_at:
      typeof meta.revealed_at === "string" ? meta.revealed_at : null,
    spotify_url:
      typeof meta.spotify_url === "string" ? meta.spotify_url : null,
    spotify_uri:
      typeof meta.spotify_uri === "string" ? meta.spotify_uri : null,
    question_id:
      typeof value.question_id === "string" ? value.question_id : null,
    nomination_origin:
      typeof meta.nomination_origin === "string" ? meta.nomination_origin : null,
  };
}

function asTimestamptz(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return null;
}

function asContestMeta(value: Record<string, unknown>): ContestLiveMeta | null {
  if (typeof value.status !== "string") return null;
  return {
    status: value.status,
    votingOpen: Boolean(value.voting_open),
    nominationsOpen: Boolean(value.nominations_open),
    title: typeof value.title === "string" ? value.title : null,
    resultsReveal:
      typeof value.results_reveal === "string" ? value.results_reveal : null,
    resultsRevealStep:
      typeof value.results_reveal_step === "number"
        ? value.results_reveal_step
        : Number(value.results_reveal_step) || 0,
    resultsPhase:
      typeof value.results_phase === "string" ? value.results_phase : null,
    nominatorRevealStep:
      typeof value.nominator_reveal_step === "number"
        ? value.nominator_reveal_step
        : Number(value.nominator_reveal_step) || 0,
    votingCloseMode:
      typeof value.voting_close_mode === "string" ? value.voting_close_mode : null,
    votingClosesAt: asTimestamptz(value.voting_closes_at),
    votingReopenedAt: asTimestamptz(value.voting_reopened_at),
    nominationDeadline: asTimestamptz(value.nomination_deadline),
    nominationsReopenedAt: asTimestamptz(value.nominations_reopened_at),
  };
}

function metaFingerprint(meta: ContestLiveMeta): string {
  return [
    meta.status,
    meta.votingOpen ? "1" : "0",
    meta.nominationsOpen ? "1" : "0",
    meta.resultsReveal ?? "",
    String(meta.resultsRevealStep),
    meta.resultsPhase ?? "",
    String(meta.nominatorRevealStep),
    meta.votingCloseMode ?? "",
    meta.votingClosesAt ?? "",
    meta.votingReopenedAt ?? "",
    meta.nominationDeadline ?? "",
    meta.nominationsReopenedAt ?? "",
  ].join("|");
}

function candidatesFingerprint(rows: LiveCandidateRow[]): string {
  return rows
    .map(
      (row) =>
        `${row.id}:${row.status}:${row.title}:${row.artist ?? ""}:${row.url ?? ""}:${row.nominator_user_id ?? ""}:${row.display_order ?? ""}`,
    )
    .sort()
    .join("|");
}

function votersFingerprint(
  voters: Array<{
    voterUserId: string;
    updatedAt: string | null;
    ballotCount?: number;
  }>,
): string {
  return voters
    .map(
      (voter) =>
        `${voter.voterUserId}:${voter.updatedAt ?? ""}:${voter.ballotCount ?? 1}`,
    )
    .sort()
    .join("|");
}

function membersFingerprint(members: LiveMemberRow[]): string {
  return members
    .map(
      (member) =>
        `${member.id}:${member.userId}:${member.displayName}:${member.role}`,
    )
    .sort()
    .join("|");
}

function contestSyncChannelName(contestId: string) {
  return `contest-sync:${contestId}`;
}

/**
 * Notify all contest tabs to re-fetch snapshot immediately (Realtime Broadcast).
 * Used after host actions so peers do not wait for postgres_changes.
 *
 * Sends on a short-lived channel of the same topic peers already listen on.
 * Retries once if the first subscribe/send fails.
 */
export async function broadcastContestResync(contestId: string): Promise<void> {
  const supabase = createClient();
  const topic = contestSyncChannelName(contestId);

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
        payload: { t: Date.now() },
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
 * Event-driven contest sync:
 * - Realtime postgres_changes + broadcast "resync" after host/participant actions
 * - One snapshot when the channel connects
 * - Re-sync when the tab becomes visible / comes online again
 * - No continuous polling by default (was the main egress driver)
 */
export function ContestLiveRefresh({
  contestId,
  debounceMs = 200,
  pollIntervalMs = 0,
  currentUserId,
  ejectIfRemoved = false,
}: ContestLiveRefreshProps) {
  const router = useRouter();
  const timerRef = useRef<number | null>(null);
  const reconcileTimerRef = useRef<number | null>(null);
  const lastMetaFpRef = useRef<string | null>(null);
  const lastMetaRef = useRef<ContestLiveMeta | null>(null);
  const lastCandidatesFpRef = useRef<string | null>(null);
  const lastVotersFpRef = useRef<string | null>(null);
  const lastMembersFpRef = useRef<string | null>(null);
  const lastBirthdayFpRef = useRef<string | null>(null);
  const syncInFlightRef = useRef(false);
  const syncAgainRef = useRef(false);
  const sawSelfAsMemberRef = useRef(false);
  const ejectedRef = useRef(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let retryTimer: number | null = null;
    let pollTimer: number | null = null;
    let retries = 0;

    function scheduleRefresh(immediate = false) {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
      }
      const run = () => {
        emitCandidatePatch(contestId, { type: "refresh" });
        router.refresh();
      };
      if (immediate) {
        run();
        return;
      }
      timerRef.current = window.setTimeout(run, debounceMs);
    }

    /** Coalesce bursty DB events (bulk reveal, many ballots) into one snapshot. */
    function scheduleReconcile(delayMs = 400) {
      if (reconcileTimerRef.current != null) {
        window.clearTimeout(reconcileTimerRef.current);
      }
      reconcileTimerRef.current = window.setTimeout(() => {
        reconcileTimerRef.current = null;
        void syncFromServer(true);
      }, delayMs);
    }

    function applyMeta(meta: ContestLiveMeta): boolean {
      const fingerprint = metaFingerprint(meta);
      if (fingerprint === lastMetaFpRef.current) return false;
      lastMetaFpRef.current = fingerprint;
      const prev = lastMetaRef.current;
      lastMetaRef.current = meta;
      emitContestMeta(contestId, meta);

      // Always notify listeners for reveal-step ticks, but only soft-refresh RSC
      // when structural contest fields change. Pure presentation advances must not
      // wait on (or get rewound by) a round-trip refresh.
      if (!prev) return true;
      return (
        prev.status !== meta.status ||
        prev.votingOpen !== meta.votingOpen ||
        prev.nominationsOpen !== meta.nominationsOpen ||
        prev.resultsPhase !== meta.resultsPhase ||
        prev.resultsReveal !== meta.resultsReveal ||
        prev.votingCloseMode !== meta.votingCloseMode ||
        prev.votingClosesAt !== meta.votingClosesAt ||
        prev.votingReopenedAt !== meta.votingReopenedAt ||
        prev.nominationDeadline !== meta.nominationDeadline ||
        prev.nominationsReopenedAt !== meta.nominationsReopenedAt ||
        prev.title !== meta.title
      );
    }

    function applyCandidates(rows: LiveCandidateRow[]): boolean {
      const fingerprint = candidatesFingerprint(rows);
      if (fingerprint === lastCandidatesFpRef.current) return false;
      lastCandidatesFpRef.current = fingerprint;
      emitCandidatePatch(contestId, { type: "replace", rows });
      return true;
    }

    function applyVoters(
      voters: Array<{
        voterUserId: string;
        updatedAt: string | null;
        ballotCount?: number;
      }>,
    ): boolean {
      const fingerprint = votersFingerprint(voters);
      if (fingerprint === lastVotersFpRef.current) return false;
      lastVotersFpRef.current = fingerprint;
      emitBallotPatch(contestId, { type: "replace", voters });
      return true;
    }

    function ejectRemovedUser() {
      if (!ejectIfRemoved || ejectedRef.current || cancelled) return;
      ejectedRef.current = true;
      router.replace("/?removed=1");
    }

    function applyMembers(members: LiveMemberRow[]): boolean {
      if (ejectIfRemoved && currentUserId) {
        const hasSelf = members.some((member) => member.userId === currentUserId);
        if (hasSelf) {
          sawSelfAsMemberRef.current = true;
        } else if (sawSelfAsMemberRef.current) {
          ejectRemovedUser();
          return true;
        }
      }

      const fingerprint = membersFingerprint(members);
      if (fingerprint === lastMembersFpRef.current) return false;
      lastMembersFpRef.current = fingerprint;
      emitMemberPatch(contestId, { type: "replace", members });
      return true;
    }

    function applyBirthdaySubmits(userIds: string[]): boolean {
      const fingerprint = [...userIds].sort().join("|");
      if (fingerprint === lastBirthdayFpRef.current) return false;
      lastBirthdayFpRef.current = fingerprint;
      emitBirthdaySubmitPatch(contestId, {
        type: "replace",
        submittedUserIds: userIds,
      });
      return true;
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
          const [contestRes, candidatesRes, turnoutRes, membersRes, birthdayRes] =
            await Promise.all([
              supabase
                .from("contests")
                .select(CONTEST_META_COLUMNS)
                .eq("id", contestId)
                .maybeSingle(),
              supabase
                .from("candidates")
                .select(CANDIDATE_COLUMNS)
                .eq("contest_id", contestId),
              supabase
                .from("ballot_turnout")
                .select("voter_user_id, updated_at, submitted_at, ballot_count")
                .eq("contest_id", contestId),
              supabase
                .from("contest_members")
                .select("id, user_id, display_name, role, joined_at")
                .eq("contest_id", contestId),
              supabase
                .from("birthday_nominations")
                .select("user_id")
                .eq("contest_id", contestId),
            ]);

          if (cancelled) continue;

          let changed = false;

          if (
            ejectIfRemoved &&
            !contestRes.error &&
            !contestRes.data &&
            lastMetaRef.current != null
          ) {
            // Contest row vanished under RLS after membership was removed.
            ejectRemovedUser();
            return;
          }

          if (!contestRes.error && contestRes.data) {
            const meta = asContestMeta(contestRes.data as Record<string, unknown>);
            if (meta) changed = applyMeta(meta) || changed;
          }

          if (!candidatesRes.error && Array.isArray(candidatesRes.data)) {
            const rows = candidatesRes.data
              .map((row) => asCandidateRow(row as Record<string, unknown>))
              .filter((row): row is LiveCandidateRow => row != null);
            changed = applyCandidates(rows) || changed;
          }

          if (!turnoutRes.error && Array.isArray(turnoutRes.data)) {
            const voters = turnoutRes.data
              .map((row) => {
                const record = row as Record<string, unknown>;
                if (typeof record.voter_user_id !== "string") return null;
                const rawCount = record.ballot_count;
                const ballotCount =
                  typeof rawCount === "number" && rawCount > 0
                    ? rawCount
                    : typeof rawCount === "string" && Number(rawCount) > 0
                      ? Number(rawCount)
                      : 1;
                return {
                  voterUserId: record.voter_user_id,
                  updatedAt:
                    asTimestamptz(record.updated_at) ??
                    asTimestamptz(record.submitted_at),
                  ballotCount,
                };
              })
              .filter(
                (
                  row,
                ): row is {
                  voterUserId: string;
                  updatedAt: string | null;
                  ballotCount: number;
                } => row != null,
              );
            changed = applyVoters(voters) || changed;
          }

          if (!membersRes.error && Array.isArray(membersRes.data)) {
            const members = membersRes.data
              .map((row) => {
                const record = row as Record<string, unknown>;
                if (
                  typeof record.id !== "string" ||
                  typeof record.user_id !== "string" ||
                  typeof record.display_name !== "string" ||
                  typeof record.role !== "string"
                ) {
                  return null;
                }
                return {
                  id: record.id,
                  userId: record.user_id,
                  displayName: record.display_name,
                  role: record.role,
                  joinedAt:
                    typeof record.joined_at === "string" ? record.joined_at : null,
                };
              })
              .filter((row) => row !== null) as LiveMemberRow[];
            changed = applyMembers(members) || changed;
          }

          if (!birthdayRes.error && Array.isArray(birthdayRes.data)) {
            const userIds = birthdayRes.data
              .map((row) => (row as { user_id?: unknown }).user_id)
              .filter((id): id is string => typeof id === "string");
            changed = applyBirthdaySubmits(userIds) || changed;
          }

          if (changed && refreshOnChange) {
            scheduleRefresh(true);
          }
        } while (!cancelled && syncAgainRef.current);
      } finally {
        syncInFlightRef.current = false;
      }
    }

    function onCandidateChange(
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
    ) {
      if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
        const row = asCandidateRow(payload.new as Record<string, unknown>);
        if (!row) return;
        if (row.status === "withdrawn" || row.status === "rejected") {
          emitCandidatePatch(contestId, { type: "remove", id: row.id });
        } else {
          emitCandidatePatch(contestId, { type: "upsert", row });
        }
      } else if (payload.eventType === "DELETE") {
        const old = payload.old as Record<string, unknown>;
        if (typeof old.id === "string") {
          emitCandidatePatch(contestId, { type: "remove", id: old.id });
        }
      }
      // Local patch first; one coalesced snapshot covers bulk reveals.
      scheduleReconcile(500);
    }

    function onContestChange(
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
    ) {
      if (payload.eventType === "UPDATE" || payload.eventType === "INSERT") {
        const meta = asContestMeta(payload.new as Record<string, unknown>);
        if (meta) {
          const needsRefresh = applyMeta(meta);
          if (needsRefresh) scheduleRefresh(true);
        }
      }
      scheduleReconcile(300);
    }

    function onBallotChange(
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
    ) {
      if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
        const row = payload.new as Record<string, unknown>;
        if (typeof row.voter_user_id === "string") {
          emitBallotPatch(contestId, {
            type: "upsert",
            voterUserId: row.voter_user_id,
            updatedAt:
              asTimestamptz(row.updated_at) ?? asTimestamptz(row.submitted_at),
          });
        }
      } else if (payload.eventType === "DELETE") {
        const row = payload.old as Record<string, unknown>;
        if (typeof row.voter_user_id === "string") {
          emitBallotPatch(contestId, {
            type: "remove",
            voterUserId: row.voter_user_id,
          });
        }
      }
      scheduleReconcile(500);
    }

    function onGenericChange() {
      scheduleReconcile(500);
    }

    function startPolling() {
      if (!pollIntervalMs || pollIntervalMs < 5_000) return;
      if (pollTimer != null) window.clearInterval(pollTimer);
      pollTimer = window.setInterval(() => {
        if (cancelled) return;
        if (document.visibilityState !== "visible") return;
        void syncFromServer(true);
      }, pollIntervalMs);
    }

    async function syncRealtimeAuth(accessToken: string | undefined | null) {
      // Without the member JWT, RLS silently drops postgres_changes events.
      await supabase.realtime.setAuth(accessToken ?? null);
    }

    function bindChannel() {
      if (cancelled) return;
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }

      channel = supabase
        .channel(contestSyncChannelName(contestId), {
          config: { broadcast: { self: false } },
        })
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "candidates",
            filter: `contest_id=eq.${contestId}`,
          },
          onCandidateChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "ballots",
            filter: `contest_id=eq.${contestId}`,
          },
          onBallotChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "ballot_turnout",
            filter: `contest_id=eq.${contestId}`,
          },
          onBallotChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "contest_members",
            filter: `contest_id=eq.${contestId}`,
          },
          onGenericChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "birthday_nominations",
            filter: `contest_id=eq.${contestId}`,
          },
          onGenericChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "curated_birthday_entries",
            filter: `contest_id=eq.${contestId}`,
          },
          onGenericChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "contests",
            filter: `id=eq.${contestId}`,
          },
          onContestChange,
        )
        .on("broadcast", { event: "resync" }, () => {
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
        startPolling();
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
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
      }
      if (reconcileTimerRef.current != null) {
        window.clearTimeout(reconcileTimerRef.current);
      }
      if (retryTimer != null) {
        window.clearTimeout(retryTimer);
      }
      if (pollTimer != null) {
        window.clearInterval(pollTimer);
      }
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [
    contestId,
    debounceMs,
    pollIntervalMs,
    router,
    currentUserId,
    ejectIfRemoved,
  ]);

  return null;
}
