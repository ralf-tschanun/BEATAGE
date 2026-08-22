"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CheckIcon,
  EyeIcon,
  EyeSlashIcon,
  HourglassSimpleIcon,
  LockSimpleIcon,
  LockSimpleOpenIcon,
  PresentationIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import {
  applyCandidateLivePatch,
  subscribeContestBallots,
  subscribeContestCandidates,
  subscribeContestMembers,
  subscribeContestMeta,
  type LiveCandidateRow,
} from "@/components/contest-live-refresh";
import { countCandidateRevealProgress } from "@/components/candidate-reveal-status";
import { isInstantResultsReveal } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { setAcknowledgedContestActivity } from "@/lib/contest-activity-ack";
import { contestActivitySnapshot } from "@/lib/contest-activity-unread";
import {
  isContestTabId,
  persistContestTab,
  readPersistedContestTab,
  type ContestParticipantTabId,
} from "@/lib/contest-tab-persist";

export type { ContestParticipantTabId };

type ContestTabsContextValue = {
  active: ContestParticipantTabId;
  setActive: (id: ContestParticipantTabId) => void;
};

const ContestTabsContext = createContext<ContestTabsContextValue | null>(null);

export function useContestParticipantTabs() {
  return useContext(ContestTabsContext);
}

/** Minimal candidate fields for tab status badges (live-updated). */
export type ContestTabCandidateSnapshot = {
  id: string;
  status: string;
  nominator_user_id: string | null;
  nomination_origin?: string | null;
};

export type ContestTabStatusProps = {
  currentUserId: string;
  nominationsOpen: boolean;
  /** Cap for nominate progress; null = unlimited (show count only). */
  nominateMaxCount: number | null;
  /**
   * Host curated nominate path (combined host-not-participating / curated).
   * Progress counts all active candidates toward max_candidates.
   */
  nominateCountsAllActive?: boolean;
  candidateSource: string;
  hostUserId: string | null;
  /**
   * When true, candidates stay locked until at least one is revealed
   * (unless viewer is host).
   */
  deferredCandidateReveal: boolean;
  /** Host reveals candidates manually — Candidates tab shows revealed/total. */
  needsAdminReveal?: boolean;
  isHost: boolean;
  /** True when this participant has submitted their vote/ratings. */
  voteSubmitted?: boolean;
  /** Results presentation progress for the Results tab badge. */
  resultsPresentation?: {
    contestStatus: string;
    resultsReveal: string;
    resultsPhase: string;
    resultsRevealStep: number;
    resultsMaxStep: number;
    nominatorRanking: boolean;
    nominatorRankingWhen: string;
    nominatorRevealStep: number;
    nominatorMaxStep: number;
  };
  /** Contest candidates; used for lock/count/progress badges. */
  candidates: ContestTabCandidateSnapshot[];
};

type ContestParticipantTabsProps = {
  showNominate: boolean;
  /** Host-only run-of-show tab. */
  showHost?: boolean;
  /** Preferred tab when the page loads. */
  defaultTab?: ContestParticipantTabId;
  /**
   * True when defaultTab already matches the persisted tab (cookie / query).
   * Skip the pre-hydration hide so the correct panel can paint immediately.
   */
  ssrTabTrusted?: boolean;
  /**
   * Contest chrome above the tab bar (title, rules, status, participants).
   * Must be a React node — not a render function (Server → Client safe).
   */
  chrome: ReactNode;
  contestId: string;
  initialVotingOpen?: boolean;
  /** Member count for the Participants tab badge (live-updated). */
  initialMemberCount?: number;
  tabStatus: ContestTabStatusProps;
  nominate?: ReactNode;
  candidates: ReactNode;
  results: ReactNode;
  participants: ReactNode;
  hostArea?: ReactNode;
};

function isActiveRow(
  row: Pick<ContestTabCandidateSnapshot, "status">,
): boolean {
  return row.status !== "withdrawn" && row.status !== "rejected";
}

function isOwnParticipantNomination(
  row: ContestTabCandidateSnapshot,
  opts: {
    currentUserId: string;
    candidateSource: string;
    hostUserId: string | null;
  },
): boolean {
  if (!isActiveRow(row)) return false;
  if (row.nominator_user_id !== opts.currentUserId) return false;
  if (row.nomination_origin === "curated") return false;
  if (row.nomination_origin === "user") return true;
  if (
    opts.candidateSource === "combined" &&
    opts.hostUserId &&
    row.nominator_user_id === opts.hostUserId
  ) {
    return false;
  }
  if (opts.candidateSource === "curated") return false;
  return true;
}

function isRevealedCandidate(
  row: Pick<ContestTabCandidateSnapshot, "status">,
): boolean {
  return row.status === "visible" || row.status === "in_voting";
}

function deriveTabBadges(
  rows: ContestTabCandidateSnapshot[],
  opts: {
    currentUserId: string;
    isHost: boolean;
    deferredCandidateReveal: boolean;
    nominateCountsAllActive: boolean;
    candidateSource: string;
    hostUserId: string | null;
  },
) {
  const nominateSubmitted = opts.nominateCountsAllActive
    ? rows.filter(isActiveRow).length
    : rows.filter((row) => isOwnParticipantNomination(row, opts)).length;
  const candidateCount = rows.filter(isRevealedCandidate).length;
  const candidatesUnlocked =
    opts.isHost || !opts.deferredCandidateReveal || candidateCount > 0;
  const revealProgress = countCandidateRevealProgress(rows);
  return {
    nominateSubmitted,
    candidateCount,
    candidatesUnlocked,
    revealedCount: revealProgress.revealedCount,
    revealTotalCount: revealProgress.totalCount,
    pendingRevealCount: revealProgress.pendingCount,
  };
}

function deriveResultsTabBadge(input: {
  contestStatus: string;
  resultsReveal: string;
  resultsPhase: string;
  resultsRevealStep: number;
  resultsMaxStep: number;
  nominatorRanking: boolean;
  nominatorRankingWhen: string;
  nominatorRevealStep: number;
  nominatorMaxStep: number;
}): {
  kind: "waiting" | "live" | "active" | "done";
  candidateCurrent: number;
  candidateTotal: number;
  candidateComplete: boolean;
  showNominator: boolean;
  nominatorCurrent: number;
  nominatorTotal: number;
  nominatorComplete: boolean;
} {
  const candidateTotal = Math.max(0, input.resultsMaxStep);
  const nominatorTotal = Math.max(0, input.nominatorMaxStep);
  const showNominator = input.nominatorRanking;

  const empty = {
    candidateCurrent: 0,
    candidateTotal,
    candidateComplete: false,
    showNominator,
    nominatorCurrent: 0,
    nominatorTotal,
    nominatorComplete: false,
  };

  if (input.resultsPhase === "done") {
    return {
      kind: "done",
      candidateCurrent: candidateTotal,
      candidateTotal,
      candidateComplete: true,
      showNominator,
      nominatorCurrent: nominatorTotal,
      nominatorTotal,
      nominatorComplete: true,
    };
  }

  if (input.contestStatus !== "finished") {
    if (input.resultsReveal === "live" && input.contestStatus === "voting") {
      return { kind: "live", ...empty };
    }
    return { kind: "waiting", ...empty };
  }

  // Place / ballot reveals: maxStep is candidates (last_to_first / first_to_last)
  // or eligible ballots (by_participant). Instant modes have maxStep 0 → complete.
  const candidateInstant = isInstantResultsReveal(input.resultsReveal);
  const candidateComplete =
    candidateInstant ||
    (candidateTotal > 0 && input.resultsRevealStep >= candidateTotal);
  const candidateCurrent = candidateInstant
    ? candidateTotal
    : Math.min(Math.max(0, input.resultsRevealStep), candidateTotal || 0);

  // Nominator: parallel / all-at-once have maxStep 0. Stepped places use nominatorMaxStep.
  const nominatorInstant = nominatorTotal < 1;
  let nominatorCurrent = 0;
  let nominatorComplete = !showNominator;
  if (showNominator) {
    if (nominatorInstant) {
      if (input.nominatorRankingWhen === "parallel") {
        nominatorComplete = candidateComplete;
      } else if (input.nominatorRankingWhen === "before") {
        nominatorComplete = true;
      } else {
        // after: shown all at once when nominators phase starts
        nominatorComplete =
          input.resultsPhase === "nominators" || input.resultsPhase === "done";
      }
    } else if (
      input.nominatorRankingWhen === "after" &&
      input.resultsPhase === "candidates"
    ) {
      nominatorCurrent = 0;
      nominatorComplete = false;
    } else {
      nominatorCurrent = Math.min(
        Math.max(0, input.nominatorRevealStep),
        nominatorTotal,
      );
      nominatorComplete = nominatorCurrent >= nominatorTotal;
    }
  }

  return {
    kind: "active",
    candidateCurrent,
    candidateTotal,
    candidateComplete,
    showNominator,
    nominatorCurrent,
    nominatorTotal,
    nominatorComplete,
  };
}

type HostPipelineStepId = "nom" | "cand" | "vote" | "res";
type HostPipelineStepState = "done" | "active" | "todo";

type HostPipelineStep = {
  id: HostPipelineStepId;
  label: string;
  state: HostPipelineStepState;
};

/** Compact Host Area tab pipeline: Nom → Cand? → Vote → Res. */
function deriveHostTabPipeline(input: {
  nominationsOpen: boolean;
  contestStatus: string;
  needsAdminReveal: boolean;
  pendingRevealCount: number;
  revealedCount: number;
  resultsPhase: string;
}): HostPipelineStep[] {
  const finished = input.contestStatus === "finished";
  const voting = input.contestStatus === "voting";

  const nomDone = !input.nominationsOpen || voting || finished;
  const candApplicable = input.needsAdminReveal;
  const candDone =
    !candApplicable ||
    (input.pendingRevealCount === 0 &&
      (input.revealedCount > 0 || voting || finished));
  const voteDone = finished;
  const resDone = finished && input.resultsPhase === "done";

  let active: HostPipelineStepId | null = null;
  if (!nomDone) active = "nom";
  else if (candApplicable && !candDone) active = "cand";
  else if (!voteDone) active = "vote";
  else if (!resDone) active = "res";

  function stateFor(
    id: HostPipelineStepId,
    done: boolean,
  ): HostPipelineStepState {
    if (done) return "done";
    if (active === id) return "active";
    return "todo";
  }

  const steps: HostPipelineStep[] = [
    { id: "nom", label: "Nom", state: stateFor("nom", nomDone) },
  ];
  if (candApplicable) {
    steps.push({
      id: "cand",
      label: "Cand",
      state: stateFor("cand", candDone),
    });
  }
  steps.push(
    { id: "vote", label: "Vote", state: stateFor("vote", voteDone) },
    { id: "res", label: "Res", state: stateFor("res", resDone) },
  );
  return steps;
}

export function ContestParticipantTabs({
  showNominate,
  showHost = false,
  defaultTab,
  ssrTabTrusted = false,
  chrome,
  contestId,
  initialVotingOpen = false,
  initialMemberCount = 0,
  tabStatus,
  nominate,
  candidates,
  results,
  participants,
  hostArea,
}: ContestParticipantTabsProps) {
  const tabs = useMemo(() => {
    const ids: ContestParticipantTabId[] = [];
    if (showNominate) ids.push("nominate");
    ids.push("candidates", "results", "participants");
    if (showHost) ids.push("host");
    return ids;
  }, [showNominate, showHost]);

  const initial = useMemo(() => {
    if (defaultTab && tabs.includes(defaultTab)) return defaultTab;
    return tabs[0] ?? "candidates";
  }, [defaultTab, tabs]);

  const [active, setActive] = useState<ContestParticipantTabId>(initial);
  const [tabReady, setTabReady] = useState(ssrTabTrusted);
  const [votingOpen, setVotingOpen] = useState(initialVotingOpen);
  const [memberCount, setMemberCount] = useState(initialMemberCount);
  const [nominationsOpen, setNominationsOpen] = useState(
    tabStatus.nominationsOpen,
  );
  const [candidateRows, setCandidateRows] = useState(tabStatus.candidates);
  const [voteSubmitted, setVoteSubmitted] = useState(
    tabStatus.voteSubmitted === true,
  );
  const [contestStatus, setContestStatus] = useState(
    tabStatus.resultsPresentation?.contestStatus ?? "open",
  );
  const [resultsPhase, setResultsPhase] = useState(
    tabStatus.resultsPresentation?.resultsPhase ?? "candidates",
  );
  const [resultsRevealStep, setResultsRevealStep] = useState(
    tabStatus.resultsPresentation?.resultsRevealStep ?? 0,
  );
  const [nominatorRevealStep, setNominatorRevealStep] = useState(
    tabStatus.resultsPresentation?.nominatorRevealStep ?? 0,
  );
  const [unreadByTab, setUnreadByTab] = useState<
    Partial<Record<ContestParticipantTabId, boolean>>
  >({});

  /** Baseline for change detection — skip the first snapshot so load isn't "unread". */
  const changeBaselineRef = useRef<{
    memberCount: number;
    revealedCount: number;
    nominationsOpen: boolean;
    votingOpen: boolean;
    contestStatus: string;
    resultsRevealStep: number;
    nominatorRevealStep: number;
  } | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const clearUnread = useCallback((id: ContestParticipantTabId) => {
    setUnreadByTab((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const markUnread = useCallback((id: ContestParticipantTabId) => {
    if (activeRef.current === id) return;
    setUnreadByTab((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  }, []);

  useEffect(() => {
    setVotingOpen(initialVotingOpen);
  }, [initialVotingOpen]);

  useEffect(() => {
    setMemberCount(initialMemberCount);
  }, [initialMemberCount]);

  useEffect(() => {
    setNominationsOpen(tabStatus.nominationsOpen);
    setCandidateRows(tabStatus.candidates);
    setVoteSubmitted(tabStatus.voteSubmitted === true);
    if (tabStatus.resultsPresentation) {
      setContestStatus(tabStatus.resultsPresentation.contestStatus);
      setResultsPhase(tabStatus.resultsPresentation.resultsPhase);
      setResultsRevealStep(tabStatus.resultsPresentation.resultsRevealStep);
      setNominatorRevealStep(tabStatus.resultsPresentation.nominatorRevealStep);
    }
  }, [
    tabStatus.nominationsOpen,
    tabStatus.candidates,
    tabStatus.voteSubmitted,
    tabStatus.resultsPresentation,
  ]);

  useEffect(() => {
    return subscribeContestMeta(contestId, (meta) => {
      setVotingOpen(meta.votingOpen);
      setNominationsOpen(meta.nominationsOpen);
      setContestStatus(meta.status);
      if (meta.resultsPhase) setResultsPhase(meta.resultsPhase);
      setResultsRevealStep(meta.resultsRevealStep);
      setNominatorRevealStep(meta.nominatorRevealStep);
    });
  }, [contestId]);

  useEffect(() => {
    return subscribeContestMembers(contestId, (patch) => {
      if (patch.type === "replace") {
        setMemberCount(patch.members.length);
      }
    });
  }, [contestId]);

  useEffect(() => {
    return subscribeContestCandidates(contestId, (patch) => {
      setCandidateRows((prev) => {
        const next = applyCandidateLivePatch(prev, patch, (row: LiveCandidateRow) => ({
          id: row.id,
          status: row.status,
          nominator_user_id: row.nominator_user_id,
          nomination_origin: row.nomination_origin ?? null,
        }));
        return next ?? prev;
      });
    });
  }, [contestId]);

  useEffect(() => {
    return subscribeContestBallots(contestId, (patch) => {
      if (patch.type === "refresh") return;
      if (patch.type === "replace") {
        setVoteSubmitted(
          patch.voters.some(
            (voter) => voter.voterUserId === tabStatus.currentUserId,
          ),
        );
        return;
      }
      if (patch.type === "remove") {
        if (patch.voterUserId === tabStatus.currentUserId) {
          setVoteSubmitted(false);
        }
        return;
      }
      if (patch.voterUserId === tabStatus.currentUserId) {
        setVoteSubmitted(true);
      }
    });
  }, [contestId, tabStatus.currentUserId]);

  const badges = useMemo(
    () =>
      deriveTabBadges(candidateRows, {
        currentUserId: tabStatus.currentUserId,
        isHost: tabStatus.isHost,
        deferredCandidateReveal: tabStatus.deferredCandidateReveal,
        nominateCountsAllActive: tabStatus.nominateCountsAllActive === true,
        candidateSource: tabStatus.candidateSource,
        hostUserId: tabStatus.hostUserId,
      }),
    [
      candidateRows,
      tabStatus.currentUserId,
      tabStatus.isHost,
      tabStatus.deferredCandidateReveal,
      tabStatus.nominateCountsAllActive,
      tabStatus.candidateSource,
      tabStatus.hostUserId,
    ],
  );

  const resultsBadge = useMemo(() => {
    const rp = tabStatus.resultsPresentation;
    if (!rp) return null;
    return deriveResultsTabBadge({
      contestStatus,
      resultsReveal: rp.resultsReveal,
      resultsPhase,
      resultsRevealStep,
      resultsMaxStep: rp.resultsMaxStep,
      nominatorRanking: rp.nominatorRanking,
      nominatorRankingWhen: rp.nominatorRankingWhen,
      nominatorRevealStep,
      nominatorMaxStep: rp.nominatorMaxStep,
    });
  }, [
    tabStatus.resultsPresentation,
    contestStatus,
    resultsPhase,
    resultsRevealStep,
    nominatorRevealStep,
  ]);

  // Detect live changes while a tab is not open → red attention dot.
  useEffect(() => {
    const snap = {
      memberCount,
      revealedCount: badges.revealedCount,
      nominationsOpen,
      votingOpen,
      contestStatus,
      resultsRevealStep,
      nominatorRevealStep,
    };
    const prev = changeBaselineRef.current;
    if (!prev) {
      changeBaselineRef.current = snap;
      return;
    }

    if (snap.memberCount > prev.memberCount) {
      markUnread("participants");
    }
    if (snap.revealedCount > prev.revealedCount) {
      markUnread("candidates");
    }
    if (snap.nominationsOpen && !prev.nominationsOpen) {
      markUnread("nominate");
      if (showHost) markUnread("host");
    }
    if (snap.votingOpen && !prev.votingOpen) {
      markUnread("candidates");
      if (showHost) markUnread("host");
    }
    if (
      snap.resultsRevealStep > prev.resultsRevealStep ||
      snap.nominatorRevealStep > prev.nominatorRevealStep ||
      (snap.contestStatus === "finished" && prev.contestStatus !== "finished")
    ) {
      markUnread("results");
      if (showHost) markUnread("host");
    }

    changeBaselineRef.current = snap;
  }, [
    memberCount,
    badges.revealedCount,
    nominationsOpen,
    votingOpen,
    contestStatus,
    resultsRevealStep,
    nominatorRevealStep,
    markUnread,
    showHost,
  ]);

  // Opening a tab clears its attention dot (incl. Host Area link jumps).
  useEffect(() => {
    clearUnread(active);
  }, [active, clearUnread]);

  const activitySnapshot = useMemo(
    () =>
      contestActivitySnapshot({
        memberCount,
        revealedCount: badges.revealedCount,
        nominationsOpen,
        votingOpen,
        contestStatus,
        resultsRevealStep,
        nominatorRevealStep,
      }),
    [
      memberCount,
      badges.revealedCount,
      nominationsOpen,
      votingOpen,
      contestStatus,
      resultsRevealStep,
      nominatorRevealStep,
    ],
  );

  const hasUnreadTabs = Object.values(unreadByTab).some(Boolean);

  // Sync overview dot: acknowledge once every tab attention dot is cleared.
  useEffect(() => {
    if (!hasUnreadTabs) {
      setAcknowledgedContestActivity(contestId, activitySnapshot);
    }
  }, [contestId, activitySnapshot, hasUnreadTabs]);

  // Restore the last tab before paint. Hide panels until then when SSR
  // could not know the persisted tab (no cookie yet).
  useLayoutEffect(() => {
    const restored = readPersistedContestTab(contestId);
    const next =
      restored && tabs.includes(restored) ? restored : initial;
    setActive(next);
    persistContestTab(contestId, next);
    setTabReady(true);
  }, [contestId, tabs, initial]);

  useEffect(() => {
    function onHashChange() {
      const fromHash = window.location.hash.replace(/^#/, "");
      if (isContestTabId(fromHash) && tabs.includes(fromHash)) {
        setActive(fromHash);
      }
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [tabs]);

  useEffect(() => {
    if (!tabs.includes(active)) {
      const fallback = tabs[0] ?? "candidates";
      setActive(fallback);
      persistContestTab(contestId, fallback);
    }
  }, [tabs, active, contestId]);

  const setActiveSafe = useCallback(
    (id: ContestParticipantTabId) => {
      if (!tabs.includes(id)) return;
      setActive(id);
      persistContestTab(contestId, id);
    },
    [tabs, contestId],
  );

  const contextValue = useMemo(
    () => ({ active, setActive: setActiveSafe }),
    [active, setActiveSafe],
  );

  function tabLabel(id: ContestParticipantTabId): string {
    if (id === "candidates") return votingOpen ? "Voting" : "Candidates";
    if (id === "nominate") return "Nominate";
    if (id === "results") return "Results";
    if (id === "host") return "Host Area";
    return "Participants";
  }

  const nominateComplete =
    tabStatus.nominateMaxCount !== null &&
    badges.nominateSubmitted >= tabStatus.nominateMaxCount;

  function tabStatusRow(id: ContestParticipantTabId): ReactNode {
    if (id === "nominate") {
      return (
        <span className="flex items-center justify-center gap-1 text-[11px] font-normal leading-none opacity-90">
          {nominationsOpen ? (
            <LockSimpleOpenIcon
              className="size-3.5 shrink-0"
              weight="bold"
              aria-hidden
            />
          ) : (
            <LockSimpleIcon
              className="size-3.5 shrink-0"
              weight="fill"
              aria-hidden
            />
          )}
          {nominateComplete ? (
            <CheckIcon className="size-3.5 shrink-0" weight="bold" aria-hidden />
          ) : tabStatus.nominateMaxCount !== null ? (
            <span className="tabular-nums">
              {badges.nominateSubmitted}/{tabStatus.nominateMaxCount}
            </span>
          ) : (
            <span className="tabular-nums">{badges.nominateSubmitted}</span>
          )}
        </span>
      );
    }

    if (id === "candidates") {
      const showRevealProgress =
        tabStatus.needsAdminReveal === true &&
        badges.revealTotalCount > 0 &&
        (badges.pendingRevealCount > 0 || contestStatus === "open");
      return (
        <span className="flex items-center justify-center gap-1 text-[11px] font-normal leading-none opacity-90">
          {badges.candidatesUnlocked ? (
            <EyeIcon
              className="size-3.5 shrink-0"
              weight="bold"
              aria-hidden
            />
          ) : (
            <EyeSlashIcon
              className="size-3.5 shrink-0"
              weight="bold"
              aria-hidden
            />
          )}
          <span className="tabular-nums">
            {showRevealProgress
              ? `${badges.revealedCount}/${badges.revealTotalCount}`
              : badges.candidateCount}
          </span>
          {voteSubmitted ? (
            <CheckIcon className="size-3.5 shrink-0" weight="bold" aria-hidden />
          ) : null}
        </span>
      );
    }

    if (id === "results" && resultsBadge) {
      return (
        <span className="flex items-center justify-center gap-1 text-[11px] font-normal leading-none opacity-90">
          {resultsBadge.kind === "waiting" ? (
            <HourglassSimpleIcon
              className="size-3.5 shrink-0"
              weight="bold"
              aria-hidden
            />
          ) : resultsBadge.kind === "done" ? (
            <LockSimpleIcon
              className="size-3.5 shrink-0"
              weight="fill"
              aria-hidden
            />
          ) : (
            <PresentationIcon
              className="size-3.5 shrink-0"
              weight="bold"
              aria-hidden
            />
          )}
          {resultsBadge.kind === "waiting" || resultsBadge.kind === "live" ? null : (
            <>
              {resultsBadge.candidateComplete ||
              resultsBadge.kind === "done" ? (
                <CheckIcon
                  className="size-3.5 shrink-0"
                  weight="bold"
                  aria-hidden
                />
              ) : resultsBadge.candidateTotal > 0 ? (
                <span className="tabular-nums">
                  {resultsBadge.candidateCurrent}/{resultsBadge.candidateTotal}
                </span>
              ) : null}
              {resultsBadge.showNominator ? (
                resultsBadge.nominatorComplete ||
                resultsBadge.kind === "done" ? (
                  <CheckIcon
                    className="size-3.5 shrink-0"
                    weight="bold"
                    aria-hidden
                  />
                ) : resultsBadge.nominatorTotal > 0 ? (
                  <span className="tabular-nums">
                    {resultsBadge.nominatorCurrent}/{resultsBadge.nominatorTotal}
                  </span>
                ) : null
              ) : null}
            </>
          )}
        </span>
      );
    }

    if (id === "participants") {
      return (
        <span className="flex items-center justify-center gap-1 text-[11px] font-normal leading-none opacity-90">
          <UsersIcon className="size-3.5 shrink-0" weight="bold" aria-hidden />
          <span className="tabular-nums">{memberCount}</span>
        </span>
      );
    }

    if (id === "host") {
      const steps = deriveHostTabPipeline({
        nominationsOpen,
        contestStatus,
        needsAdminReveal: tabStatus.needsAdminReveal === true,
        pendingRevealCount: badges.pendingRevealCount,
        revealedCount: badges.revealedCount,
        resultsPhase,
      });
      return (
        <span className="flex items-center justify-center gap-0.5 text-[10px] font-normal leading-none tracking-tight opacity-90">
          {steps.map((step, index) => (
            <span key={step.id} className="inline-flex items-center gap-0.5">
              {index > 0 ? (
                <span className="opacity-40" aria-hidden>
                  ·
                </span>
              ) : null}
              {step.state === "done" ? (
                <CheckIcon
                  className="size-3 shrink-0"
                  weight="bold"
                  aria-hidden
                />
              ) : (
                <span
                  className={cn(
                    step.state === "active" && "font-semibold",
                    step.state === "todo" && "opacity-45",
                  )}
                >
                  {step.label}
                </span>
              )}
            </span>
          ))}
        </span>
      );
    }

    return null;
  }

  function tabAriaLabel(id: ContestParticipantTabId): string {
    const label = tabLabel(id);
    const unreadSuffix = unreadByTab[id] ? ", has updates" : "";
    if (id === "nominate") {
      const lock = nominationsOpen ? "open" : "closed";
      const progress = nominateComplete
        ? "complete"
        : tabStatus.nominateMaxCount !== null
          ? `${badges.nominateSubmitted} of ${tabStatus.nominateMaxCount}`
          : `${badges.nominateSubmitted} nominated`;
      return `${label}, nominations ${lock}, ${progress}${unreadSuffix}`;
    }
    if (id === "candidates") {
      const lock = badges.candidatesUnlocked ? "visible" : "hidden";
      const showRevealProgress =
        tabStatus.needsAdminReveal === true &&
        badges.revealTotalCount > 0 &&
        (badges.pendingRevealCount > 0 || contestStatus === "open");
      const count = showRevealProgress
        ? `${badges.revealedCount} of ${badges.revealTotalCount} revealed`
        : String(badges.candidateCount);
      return `${label}, candidates ${lock}, ${count}${
        voteSubmitted ? ", vote submitted" : ""
      }${unreadSuffix}`;
    }
    if (id === "results" && resultsBadge) {
      if (resultsBadge.kind === "waiting") {
        return `${label}, presentation coming soon${unreadSuffix}`;
      }
      if (resultsBadge.kind === "live") {
        return `${label}, live results${unreadSuffix}`;
      }
      const cand = resultsBadge.candidateComplete
        ? "voting results complete"
        : resultsBadge.candidateTotal > 0
          ? `voting results ${resultsBadge.candidateCurrent} of ${resultsBadge.candidateTotal}`
          : "voting results";
      const nom = !resultsBadge.showNominator
        ? ""
        : resultsBadge.nominatorComplete
          ? ", nominator ranking complete"
          : resultsBadge.nominatorTotal > 0
            ? `, nominator ranking ${resultsBadge.nominatorCurrent} of ${resultsBadge.nominatorTotal}`
            : "";
      if (resultsBadge.kind === "done") {
        return `${label}, presentation completed${unreadSuffix}`;
      }
      return `${label}, ${cand}${nom}${unreadSuffix}`;
    }
    if (id === "participants") {
      return `${label}, ${memberCount} member${memberCount === 1 ? "" : "s"}${unreadSuffix}`;
    }
    if (id === "host") {
      const steps = deriveHostTabPipeline({
        nominationsOpen,
        contestStatus,
        needsAdminReveal: tabStatus.needsAdminReveal === true,
        pendingRevealCount: badges.pendingRevealCount,
        revealedCount: badges.revealedCount,
        resultsPhase,
      });
      const spoken = steps
        .map((step) => {
          const name =
            step.id === "nom"
              ? "nominations"
              : step.id === "cand"
                ? "candidate reveal"
                : step.id === "vote"
                  ? "voting"
                  : "results";
          if (step.state === "done") return `${name} complete`;
          if (step.state === "active") return `${name} in progress`;
          return `${name} upcoming`;
        })
        .join(", ");
      return `${label}, ${spoken}${unreadSuffix}`;
    }
    return `${label}${unreadSuffix}`;
  }

  const tabBar = (
    <div
      role="tablist"
      aria-label="Contest sections"
      className={cn(
        "grid gap-1.5",
        tabs.length >= 5
          ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
          : tabs.length === 4
            ? "grid-cols-2 sm:grid-cols-4"
            : "grid-cols-3",
      )}
    >
      {tabs.map((id) => {
        const selected = active === id;
        const status = tabStatusRow(id);
        const hasUnread = Boolean(unreadByTab[id]);
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`contest-tabpanel-${id}`}
            aria-label={tabAriaLabel(id)}
            id={`contest-tab-${id}`}
            className={cn(
              "relative rounded-lg border px-2 py-1.5 text-center text-sm font-medium transition-colors",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-foreground hover:bg-muted/60",
            )}
            onClick={() => setActiveSafe(id)}
          >
            {hasUnread ? (
              <span
                className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-red-500 ring-2 ring-background"
                aria-hidden
              />
            ) : null}
            <span className="flex items-center justify-center gap-1 whitespace-nowrap">
              <span>{tabLabel(id)}</span>
              {status}
            </span>
          </button>
        );
      })}
    </div>
  );

  function tabPanel(id: ContestParticipantTabId, content: ReactNode | undefined) {
    if (!tabs.includes(id) || content == null) return null;
    const selected = active === id;
    return (
      <div
        key={id}
        role="tabpanel"
        id={`contest-tabpanel-${id}`}
        aria-labelledby={`contest-tab-${id}`}
        hidden={!selected}
        className="min-w-0"
      >
        {content}
      </div>
    );
  }

  return (
    <ContestTabsContext.Provider value={contextValue}>
      <div
        className={cn(
          "sticky top-14 z-40 -mx-6 border-b border-border/60 px-6 py-2",
          "bg-background/85 backdrop-blur-sm supports-[backdrop-filter]:bg-background/70",
        )}
      >
        <div className="space-y-1">
          {chrome}
          <div className={cn(!tabReady && "invisible")}>{tabBar}</div>
        </div>
      </div>

      <div className={cn("min-w-0", !tabReady && "invisible")}>
        {tabPanel("nominate", nominate)}
        {tabPanel("candidates", candidates)}
        {tabPanel("results", results)}
        {tabPanel("participants", participants)}
        {tabPanel("host", hostArea)}
      </div>
    </ContestTabsContext.Provider>
  );
}
