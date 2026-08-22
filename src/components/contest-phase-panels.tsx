"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CloseNominationsButton } from "@/components/close-nominations-button";
import { OpenNominationsButton } from "@/components/open-nominations-button";
import { ContestResults, type BallotPresenter } from "@/components/contest-results";
import {
  applyCandidateLivePatch,
  subscribeContestBallots,
  subscribeContestCandidates,
  subscribeContestMeta,
  type ContestLiveMeta,
  type LiveCandidateRow,
} from "@/components/contest-live-refresh";
import { HostTabLinkPrompt } from "@/components/host-tab-link-prompt";
import { HostResultsControls } from "@/components/host-results-controls";
import { HostRevealControls } from "@/components/host-reveal-controls";
import { HostVotingControls } from "@/components/host-voting-controls";
import { ColoredVotingStatus } from "@/components/colored-voting-status";
import { ColoredNominationStatus } from "@/components/nomination-status-badge";
import { isNominationsNotStartedYet } from "@/lib/contest-phase";
import {
  ColoredCandidateRevealStatus,
  countCandidateRevealProgress,
  resolveCandidateRevealStatus,
} from "@/components/candidate-reveal-status";
import { NominatorResults } from "@/components/nominator-results";
import { VotingBallot, type BallotCandidate } from "@/components/voting-ballot";
import { VotingStatusBadge } from "@/components/voting-status-badge";
import { CollapsibleCard } from "@/components/collapsible-card";
import { resolveHostNextAction } from "@/lib/host-next-action";
import { cn } from "@/lib/utils";
import {
  PresentationStatusLabel,
  nominatorResultsStatusKind,
  nominatorResultsStatusText,
  resultsPresentationStatusKind,
  resultsPresentationStatusText,
  votingResultsStatusKind,
  votingResultsStatusText,
} from "@/components/presentation-status";
import {
  applyResultsReveal,
  ballotsForQuestion,
  computeNominatorResults,
  computeResults,
  isStarRatingModel,
  isInlineVoteModel,
  isInlineRankChipsModel,
  isEmbeddedBallotModel,
  isRankingBallotModel,
  isBestOnlyModel,
  isParticipantNomination,
  pointsByCandidateFromBallot,
  SCORING_MODELS,
  anonymousParticipantLabel,
  isResultsRevealComplete,
  birthdayIdentitiesRevealed,
  nominatorRevealMode,
  isCuratedBirthdayContest,
  isInstantResultsReveal,
  isSteppedPlaceReveal,
  sortCandidates,
  isAdminCandidateReveal,
  isDeferredCandidateReveal,
  type CandidateReveal,
  type ContestTheme,
  type NominationKind,
  type NominatorRankingWhen,
  type NominatorResultsReveal,
  type NominatorResultRow,
  type ResultRow,
  type ResultsPhase,
  type ResultsReveal,
  type ScoringModelId,
  type SongLinksMode,
  type VoteMutability,
  type CandidateSort,
} from "@/lib/plans";

function candidatesForQuestion<T extends { questionId?: string | null }>(
  candidates: T[],
  questionId: string,
): T[] {
  const scoped = candidates.filter((candidate) => candidate.questionId === questionId);
  const shared = candidates.filter((candidate) => !candidate.questionId);
  // Per-question pools use scoped rows; shared (null) always apply to every topic.
  if (scoped.length > 0) return [...scoped, ...shared];
  return shared;
}

function toBallotCandidate(row: {
  id: string;
  title: string;
  artist: string | null;
  url?: string | null;
  created_at?: string | null;
  display_order?: number | null;
  questionId?: string | null;
  question_id?: string | null;
}): BallotCandidate & { created_at?: string | null; display_order?: number | null } {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    url: row.url ?? null,
    created_at: row.created_at,
    display_order: row.display_order,
    questionId: row.questionId ?? row.question_id ?? null,
  };
}

function mergeBallotCandidates(
  votingOpen: boolean,
  liveRows: LiveCandidateRow[],
  votingCandidates: BallotCandidate[],
  fallback: BallotCandidate[],
  candidateSort: CandidateSort,
): BallotCandidate[] {
  const byId = new Map<
    string,
    BallotCandidate & { created_at?: string | null; display_order?: number | null }
  >();

  for (const row of liveRows) {
    if (row.status === "in_voting") {
      byId.set(row.id, toBallotCandidate(row));
    } else if (votingOpen && (row.status === "visible" || row.status === "pending")) {
      byId.set(row.id, toBallotCandidate(row));
    }
  }

  if (byId.size === 0) {
    for (const row of votingCandidates) byId.set(row.id, row);
  } else {
    // Preserve question mapping from SSR when live rows omit it.
    for (const row of votingCandidates) {
      const existing = byId.get(row.id);
      if (existing && !existing.questionId && row.questionId) {
        byId.set(row.id, { ...existing, questionId: row.questionId });
      }
    }
  }
  if (byId.size === 0 && votingOpen) {
    for (const row of fallback) byId.set(row.id, row);
  }

  return sortCandidates([...byId.values()], candidateSort).map((row, index) => ({
    id: row.id,
    title: row.title,
    artist: row.artist,
    url: row.url ?? null,
    photoNumber: index + 1,
    questionId: row.questionId ?? null,
  }));
}

type ContestPhasePanelsProps = {
  contestId: string;
  joinCode: string;
  isHost: boolean;
  hostParticipates: boolean;
  theme: ContestTheme;
  revealMode: CandidateReveal;
  candidateSort: CandidateSort;
  scoringModel: ScoringModelId;
  /** Star rating: show numeric point totals next to stars. */
  showStarPoints?: boolean;
  voteMutability: VoteMutability;
  votingCloseMode: "manual" | "scheduled";
  votingClosesAt: string | null;
  votingReopenedAt?: string | null;
  resultsReveal: ResultsReveal;
  /** Mask voter names as Participant 1, 2, … during ballot-by-ballot reveals. */
  resultsAnonymous?: boolean;
  initialResultsRevealStep: number;
  resultsMaxStep: number;
  nominatorRanking: boolean;
  nominatorRankingWhen: NominatorRankingWhen;
  nominatorResultsReveal: NominatorResultsReveal;
  initialResultsPhase: ResultsPhase;
  initialNominatorRevealStep: number;
  nominatorMaxStep: number;
  /** Full ranking; reveal step applied client-side from live meta. */
  nominatorFullRows: NominatorResultRow[];
  nominatorComputeCandidates?: Array<{
    id: string;
    nominatorUserId: string | null;
    nominatorUserIds?: string[];
    nominatorKeys?: string[];
    meta?: Record<string, unknown> | null;
  }>;
  nominatorNameByKey?: Record<string, string>;
  nominatorRankingContext?: {
    candidateSource: import("@/lib/plans").CandidateSource;
    hostUserId: string | null;
  };
  excludedCandidateIds?: string[];
  initialStatus: string;
  initialVotingOpen: boolean;
  initialNominationsOpen: boolean;
  nominationDeadline: string | null;
  /** When set, Start nominations begins this countdown for everyone. */
  nominationDurationSeconds?: number | null;
  candidateCount: number;
  pendingRevealCount: number;
  votingCandidates: BallotCandidate[];
  ballotCandidatesFallback: BallotCandidate[];
  myRankings: string[] | null;
  /** Anything: rankings keyed by question id. */
  myRankingsByQuestion?: Record<string, string[]>;
  /** Contest topics/questions (song/photo now seed one topic too). */
  contestQuestions?: Array<{ id: string; name: string }>;
  ballotCount: number;
  ballotTotal: number | null;
  /** Full ranking; reveal step applied client-side from live meta. */
  fullResultRows: ResultRow[];
  /** Anything: full rankings keyed by question id. */
  fullResultRowsByQuestion?: Record<string, ResultRow[]>;
  /** For by_participant: recompute results live from ballots + reveal step. */
  resultsCandidates?: Array<{
    id: string;
    title: string;
    artist: string | null;
    url: string | null;
    questionId?: string | null;
  }>;
  resultsBallots?: Array<{
    voterUserId: string;
    rankings: string[];
    ratings?: Record<string, number> | null;
    questionId?: string | null;
  }>;
  eligibleVoters?: Array<{ userId: string; displayName: string }>;
  /** Live vote turnout seed (ballot_turnout / ballots). */
  initialVoters?: Array<{ userId: string; ballotCount?: number }>;
  /** Members for nomination turnout (eligible nominators). */
  members?: Array<{ userId: string; role: string }>;
  hostUserId?: string | null;
  /** When true, Nominate tab exists — host can be linked there. */
  showNominateTab?: boolean;
  /** Host already submitted their vote/ratings. */
  hostVoteSubmitted?: boolean;
  /** Current viewer — used for “your ballot counted” status. */
  currentUserId?: string | null;
  maxNominationsPerParticipant?: number | null;
  resultsSubtitle: string | null;
  /** Ballot-by-ballot: presented voters (last = most recent). */
  resultAfterPresenters?: BallotPresenter[] | null;
  ballotsErrorMessage: string | null;
  nominationKind?: NominationKind;
  candidateSource?: import("@/lib/plans").CandidateSource;
  birthdayLabelsByCandidateId?: Record<string, string[]>;
  curatedBirthdayEntries?: Array<{
    id: string;
    displayName: string;
    birthday: string;
    candidateId: string | null;
  }>;
  revealCandidates: Array<{
    id: string;
    title: string;
    artist: string | null;
    url?: string | null;
    status: string;
    created_at?: string | null;
    display_order?: number | null;
    nominator_user_id?: string | null;
    nomination_origin?: string | null;
  }>;
  songLinks?: SongLinksMode;
  spotifyByCandidateId?: Record<string, { url: string; uri?: string | null }>;
  /** Candidates marked delete-on-finish (cleared when presentation ends). */
  pendingPhotoDeleteCount?: number;
  /**
   * Which sections to render.
   * - all: host controls + participant results (legacy)
   * - host: host run-of-show controls only (Host Area tab)
   * - results: participant results / ballots (Results tab)
   */
  panelMode?: "all" | "host" | "results";
};

export function ContestPhasePanels({
  contestId,
  joinCode,
  isHost,
  hostParticipates,
  theme,
  revealMode,
  candidateSort,
  scoringModel,
  showStarPoints = false,
  voteMutability,
  votingCloseMode,
  votingClosesAt,
  votingReopenedAt = null,
  resultsReveal,
  resultsAnonymous = false,
  initialResultsRevealStep,
  resultsMaxStep,
  nominatorRanking,
  nominatorRankingWhen,
  nominatorResultsReveal,
  initialResultsPhase,
  initialNominatorRevealStep,
  nominatorMaxStep,
  nominatorFullRows,
  nominatorComputeCandidates = [],
  nominatorNameByKey = {},
  nominatorRankingContext,
  excludedCandidateIds = [],
  initialStatus,
  initialVotingOpen,
  initialNominationsOpen,
  nominationDeadline,
  nominationDurationSeconds = null,
  candidateCount,
  pendingRevealCount: _pendingRevealCount,
  votingCandidates,
  ballotCandidatesFallback,
  myRankings,
  myRankingsByQuestion = {},
  contestQuestions = [],
  ballotCount,
  ballotTotal,
  fullResultRows,
  fullResultRowsByQuestion = {},
  resultsCandidates = [],
  resultsBallots = [],
  eligibleVoters = [],
  initialVoters = [],
  members = [],
  hostUserId = null,
  showNominateTab = false,
  hostVoteSubmitted = false,
  currentUserId = null,
  maxNominationsPerParticipant = null,
  resultsSubtitle,
  resultAfterPresenters = null,
  ballotsErrorMessage,
  nominationKind = "standard",
  candidateSource = "user_single",
  birthdayLabelsByCandidateId,
  curatedBirthdayEntries = [],
  revealCandidates,
  songLinks = "preview",
  spotifyByCandidateId = {},
  pendingPhotoDeleteCount = 0,
  panelMode = "all",
}: ContestPhasePanelsProps) {
  const showHostPanels = panelMode === "all" || panelMode === "host";
  const [meta, setMeta] = useState<ContestLiveMeta>({
    status: initialStatus,
    votingOpen: initialVotingOpen,
    nominationsOpen: initialNominationsOpen,
    title: null,
    resultsReveal,
    resultsRevealStep: initialResultsRevealStep,
    resultsPhase: initialResultsPhase,
    nominatorRevealStep: initialNominatorRevealStep,
    votingCloseMode,
    votingClosesAt,
    votingReopenedAt,
    nominationDeadline,
    nominationsReopenedAt: null,
  });
  const [liveCandidates, setLiveCandidates] = useState<LiveCandidateRow[]>(() =>
    revealCandidates.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      artist: candidate.artist,
      url: candidate.url ?? null,
      description: null,
      status: candidate.status,
      nominator_user_id: candidate.nominator_user_id ?? null,
      nomination_origin: candidate.nomination_origin ?? null,
      created_at: candidate.created_at ?? undefined,
      display_order: candidate.display_order ?? null,
    })),
  );

  useEffect(() => {
    setMeta((prev) => {
      // Don't wipe a live admin countdown if RSC props have not caught up yet.
      const propClosesAt = votingClosesAt;
      const prevClosesMs = prev.votingClosesAt
        ? Date.parse(prev.votingClosesAt)
        : NaN;
      const keepLiveCountdown =
        !propClosesAt &&
        Number.isFinite(prevClosesMs) &&
        prevClosesMs > Date.now();

      // Presentation steps are advanced live on every client. Stale RSC props
      // must never rewind a peer that already applied a newer Realtime/poll
      // update — only a real status/phase change resets the presentation.
      const presentationReset =
        initialStatus !== prev.status ||
        initialResultsPhase !== prev.resultsPhase;
      const resultsRevealStep = presentationReset
        ? initialResultsRevealStep
        : Math.max(initialResultsRevealStep, prev.resultsRevealStep);
      const nominatorRevealStep = presentationReset
        ? initialNominatorRevealStep
        : Math.max(initialNominatorRevealStep, prev.nominatorRevealStep);

      return {
        status: initialStatus,
        votingOpen: initialVotingOpen,
        nominationsOpen: initialNominationsOpen,
        title: prev.title,
        resultsReveal,
        resultsRevealStep,
        resultsPhase: initialResultsPhase,
        nominatorRevealStep,
        votingCloseMode: keepLiveCountdown
          ? prev.votingCloseMode ?? votingCloseMode
          : votingCloseMode,
        votingClosesAt: keepLiveCountdown ? prev.votingClosesAt : propClosesAt,
        votingReopenedAt: votingReopenedAt ?? prev.votingReopenedAt,
        nominationDeadline,
        nominationsReopenedAt: prev.nominationsReopenedAt,
      };
    });
  }, [
    initialStatus,
    initialVotingOpen,
    initialNominationsOpen,
    resultsReveal,
    initialResultsRevealStep,
    initialResultsPhase,
    initialNominatorRevealStep,
    votingCloseMode,
    votingClosesAt,
    votingReopenedAt,
    nominationDeadline,
  ]);

  useEffect(() => {
    setLiveCandidates((prev) => {
      const prevById = new Map(prev.map((row) => [row.id, row]));
      return revealCandidates.map((candidate) => {
        const existing = prevById.get(candidate.id);
        return {
          id: candidate.id,
          title: candidate.title,
          artist: candidate.artist,
          // Prefer live URL (photo contests) over RSC props that may omit it.
          url: candidate.url ?? existing?.url ?? null,
          description: existing?.description ?? null,
          status: candidate.status,
          nominator_user_id:
            candidate.nominator_user_id ??
            existing?.nominator_user_id ??
            null,
          nomination_origin:
            candidate.nomination_origin ??
            existing?.nomination_origin ??
            null,
          created_at: candidate.created_at ?? existing?.created_at,
          display_order: candidate.display_order ?? null,
        };
      });
    });
  }, [revealCandidates]);

  useEffect(() => {
    return subscribeContestMeta(contestId, setMeta);
  }, [contestId]);

  useEffect(() => {
    return subscribeContestCandidates(contestId, (patch) => {
      setLiveCandidates((prev) => {
        const next = applyCandidateLivePatch(prev, patch, (row) => row);
        return next ?? prev;
      });
    });
  }, [contestId]);

  const [votersByUserId, setVotersByUserId] = useState(() => {
    const map = new Map<string, number>();
    for (const voter of initialVoters) {
      map.set(voter.userId, Math.max(1, voter.ballotCount ?? 1));
    }
    return map;
  });

  useEffect(() => {
    setVotersByUserId(() => {
      const map = new Map<string, number>();
      for (const voter of initialVoters) {
        map.set(voter.userId, Math.max(1, voter.ballotCount ?? 1));
      }
      return map;
    });
  }, [initialVoters]);

  useEffect(() => {
    return subscribeContestBallots(contestId, (patch) => {
      if (patch.type === "refresh") return;
      if (patch.type === "replace") {
        const map = new Map<string, number>();
        for (const voter of patch.voters) {
          map.set(
            voter.voterUserId,
            Math.max(1, voter.ballotCount ?? 1),
          );
        }
        setVotersByUserId(map);
        return;
      }
      if (patch.type === "remove") {
        setVotersByUserId((prev) => {
          if (!prev.has(patch.voterUserId)) return prev;
          const next = new Map(prev);
          next.delete(patch.voterUserId);
          return next;
        });
        return;
      }
      setVotersByUserId((prev) => {
        const next = new Map(prev);
        next.set(
          patch.voterUserId,
          Math.max(1, patch.ballotCount ?? prev.get(patch.voterUserId) ?? 1),
        );
        return next;
      });
    });
  }, [contestId]);

  const liveActiveCandidates = useMemo(
    () =>
      liveCandidates.filter(
        (candidate) =>
          candidate.status !== "withdrawn" && candidate.status !== "rejected",
      ),
    [liveCandidates],
  );
  const livePendingRevealCount = useMemo(
    () =>
      liveActiveCandidates.filter((candidate) => candidate.status === "pending")
        .length,
    [liveActiveCandidates],
  );
  const liveCandidateCount =
    liveActiveCandidates.length > 0 ? liveActiveCandidates.length : candidateCount;

  const requiredBallots = Math.max(1, contestQuestions.length);
  const votesTotal =
    eligibleVoters.length > 0
      ? eligibleVoters.length
      : members.filter((member) => {
          if (member.role === "participant") return true;
          if (member.role === "host") return hostParticipates;
          return false;
        }).length;
  const votesCompleted = useMemo(() => {
    let count = 0;
    const eligibleIds =
      eligibleVoters.length > 0
        ? new Set(eligibleVoters.map((v) => v.userId))
        : new Set(
            members
              .filter((member) => {
                if (member.role === "participant") return true;
                if (member.role === "host") return hostParticipates;
                return false;
              })
              .map((member) => member.userId),
          );
    for (const [userId, ballotCount] of votersByUserId) {
      if (!eligibleIds.has(userId)) continue;
      if (ballotCount >= requiredBallots) count += 1;
    }
    return count;
  }, [
    votersByUserId,
    eligibleVoters,
    members,
    hostParticipates,
    requiredBallots,
  ]);

  const nominationsTotal = useMemo(() => {
    if (nominationKind === "birthday") return 0;
    if (
      candidateSource !== "user_single" &&
      candidateSource !== "user_multiple" &&
      candidateSource !== "combined" &&
      candidateSource !== "curated"
    ) {
      return 0;
    }
    return members.filter((member) => {
      if (candidateSource === "curated") {
        return member.role === "host";
      }
      if (candidateSource === "combined") {
        return member.role === "host" || member.role === "participant";
      }
      if (member.role === "participant") return true;
      if (member.role === "host") return hostParticipates;
      return false;
    }).length;
  }, [members, candidateSource, hostParticipates, nominationKind]);

  const nominationsCompleted = useMemo(() => {
    if (nominationsTotal < 1) return 0;
    const counts = new Map<string, number>();
    for (const candidate of liveActiveCandidates) {
      if (!candidate.nominator_user_id) continue;
      if (
        !isParticipantNomination(
          {
            nominator_user_id: candidate.nominator_user_id,
            meta: candidate.nomination_origin
              ? { nomination_origin: candidate.nomination_origin }
              : null,
          },
          candidateSource,
          hostUserId,
        )
      ) {
        if (candidateSource !== "curated") {
          continue;
        }
      }
      counts.set(
        candidate.nominator_user_id,
        (counts.get(candidate.nominator_user_id) ?? 0) + 1,
      );
    }
    let done = 0;
    for (const member of members) {
      const eligible =
        candidateSource === "curated"
          ? member.role === "host"
          : candidateSource === "combined"
            ? member.role === "host" || member.role === "participant"
            : member.role === "participant" ||
              (member.role === "host" && hostParticipates);
      if (!eligible) continue;
      const count = counts.get(member.userId) ?? 0;
      if (count > 0) done += 1;
    }
    return done;
  }, [
    liveActiveCandidates,
    members,
    candidateSource,
    hostUserId,
    hostParticipates,
    nominationsTotal,
  ]);

  const hostHasNominated = useMemo(() => {
    if (!hostUserId) return false;
    return liveActiveCandidates.some(
      (candidate) =>
        candidate.nominator_user_id === hostUserId &&
        isParticipantNomination(
          {
            nominator_user_id: candidate.nominator_user_id,
            meta: candidate.nomination_origin
              ? { nomination_origin: candidate.nomination_origin }
              : null,
          },
          candidateSource,
          hostUserId,
        ),
    );
  }, [liveActiveCandidates, hostUserId, candidateSource]);

  const needsAdminReveal = isAdminCandidateReveal(revealMode);
  const deferredCandidateReveal = isDeferredCandidateReveal(revealMode);
  /** Keep reveal controls available for host review after voting starts. */
  const showRevealControls = isHost && needsAdminReveal;
  const canCastBallot =
    meta.status === "voting" &&
    meta.votingOpen &&
    !(isHost && hostParticipates === false);
  /** Candidates are ready; voting not started yet (after live noms close / admin batch reveal). */
  const candidatesReadyForVoting =
    liveCandidateCount > 0 &&
    (needsAdminReveal
      ? livePendingRevealCount === 0
      : deferredCandidateReveal
        ? !meta.nominationsOpen && livePendingRevealCount === 0
        : !meta.nominationsOpen);
  const showWaitingForVoting =
    !meta.votingOpen &&
    meta.status !== "finished" &&
    meta.status !== "expired" &&
    candidatesReadyForVoting &&
    (meta.status === "open" || meta.status === "voting");
  const liveBallotCandidates = useMemo(
    () =>
      mergeBallotCandidates(
        canCastBallot,
        liveCandidates,
        votingCandidates,
        ballotCandidatesFallback,
        candidateSort,
      ),
    [
      canCastBallot,
      liveCandidates,
      votingCandidates,
      ballotCandidatesFallback,
      candidateSort,
    ],
  );
  const photoNumberById = useMemo(() => {
    if (theme !== "photo") return {} as Record<string, number>;
    const source =
      liveBallotCandidates.length > 0
        ? liveBallotCandidates
        : ballotCandidatesFallback;
    return Object.fromEntries(
      source.map((candidate, index) => [
        candidate.id,
        candidate.photoNumber ?? index + 1,
      ]),
    );
  }, [theme, liveBallotCandidates, ballotCandidatesFallback]);
  const hasQuestions = contestQuestions.length > 0;
  const submittedAllQuestions = hasQuestions
    ? contestQuestions.every(
        (question) => (myRankingsByQuestion[question.id]?.length ?? 0) > 0,
      )
    : Boolean(myRankings?.length);
  const submittedAnyQuestion = hasQuestions
    ? contestQuestions.some(
        (question) => (myRankingsByQuestion[question.id]?.length ?? 0) > 0,
      )
    : Boolean(myRankings?.length);
  const ballotLocked =
    submittedAllQuestions &&
    (voteMutability === "locked_on_submit" || !canCastBallot);
  const canVoteAsParticipant = !(isHost && hostParticipates === false);
  const votingEnded =
    meta.status === "finished" ||
    (meta.status === "voting" && !meta.votingOpen);
  const missedDeadline =
    votingEnded && canVoteAsParticipant && !submittedAnyQuestion;
  const showMyBallot =
    canCastBallot || submittedAnyQuestion || missedDeadline;
  const liveVotingCloseMode =
    meta.votingCloseMode === "scheduled" || meta.votingCloseMode === "manual"
      ? meta.votingCloseMode
      : votingCloseMode;
  const liveVotingClosesAt = meta.votingClosesAt ?? votingClosesAt;
  // Admin "Close voting in Ns" sets voting_closes_at (+ mode scheduled). Show
  // countdown whenever a future close time is present — same as nominations.
  const countdownClosesAt =
    liveVotingClosesAt && Date.parse(liveVotingClosesAt) > Date.now()
      ? liveVotingClosesAt
      : liveVotingCloseMode === "scheduled"
        ? liveVotingClosesAt
        : null;
  const votingStatusBadge = (
    <VotingStatusBadge
      votingOpen={meta.votingOpen && meta.status === "voting"}
      votingClosesAt={countdownClosesAt}
      votingReopenedAt={meta.votingReopenedAt}
    />
  );
  const showLiveResults =
    resultsReveal === "live" && meta.status === "voting";
  const showResults = meta.status === "finished" || showLiveResults;
  const revealStep = meta.resultsRevealStep;
  const resultsComplete = isResultsRevealComplete(
    resultsReveal,
    revealStep,
    resultsMaxStep,
  );
  const phase: ResultsPhase =
    meta.resultsPhase === "nominators" || meta.resultsPhase === "done"
      ? meta.resultsPhase
      : "candidates";
  const nomMode = nominatorRevealMode(
    nominatorResultsReveal,
    nominatorRankingWhen,
  );
  const nominatorComplete = isResultsRevealComplete(
    nomMode,
    meta.nominatorRevealStep,
    nominatorMaxStep,
  );
  const revealBirthdayIds = birthdayIdentitiesRevealed({
    nominationKind,
    status: meta.status,
    resultsPhase: phase,
    nominatorRanking,
    nominatorRankingWhen,
    nominatorResultsReveal,
    resultsReveal,
    resultsRevealStep: revealStep,
    resultsMaxStep,
    nominatorRevealStep: meta.nominatorRevealStep,
    nominatorMaxStep,
  });
  const visibleBirthdayLabels = revealBirthdayIds
    ? birthdayLabelsByCandidateId
    : undefined;
  const showCandidateBlock =
    showResults &&
    !(nominatorRanking && nominatorRankingWhen === "before" && phase === "nominators");
  const showNominatorBlock =
    meta.status === "finished" &&
    showResults &&
    nominatorRanking &&
    (nominatorRankingWhen === "parallel"
      ? showCandidateBlock
      : !(nominatorRankingWhen === "after" && phase === "candidates"));

  const liveResultRows = useMemo(() => {
    if (hasQuestions) return [];
    if (resultsReveal === "by_participant") {
      if (revealStep <= 0) return [];
      const includedIds = new Set(
        eligibleVoters.slice(0, revealStep).map((voter) => voter.userId),
      );
      const includedBallots = resultsBallots.filter((ballot) =>
        includedIds.has(ballot.voterUserId),
      );
      return computeResults(scoringModel, resultsCandidates, includedBallots);
    }
    if (resultsReveal === "live") {
      return computeResults(scoringModel, resultsCandidates, resultsBallots);
    }
    return applyResultsReveal(resultsReveal, revealStep, fullResultRows);
  }, [
    hasQuestions,
    resultsReveal,
    revealStep,
    fullResultRows,
    eligibleVoters,
    resultsBallots,
    resultsCandidates,
    scoringModel,
  ]);

  const liveResultRowsByQuestion = useMemo(() => {
    if (!hasQuestions) return {} as Record<string, typeof fullResultRows>;
    return Object.fromEntries(
      contestQuestions.map((question) => {
        const questionCandidates = candidatesForQuestion(
          resultsCandidates,
          question.id,
        );
        const questionBallots = ballotsForQuestion(resultsBallots, question.id);
        const questionFull =
          fullResultRowsByQuestion[question.id] ??
          computeResults(scoringModel, questionCandidates, questionBallots);
        if (resultsReveal === "by_participant") {
          if (revealStep <= 0) return [question.id, []] as const;
          const includedIds = new Set(
            eligibleVoters.slice(0, revealStep).map((voter) => voter.userId),
          );
          const includedBallots = questionBallots.filter((ballot) =>
            includedIds.has(ballot.voterUserId),
          );
          return [
            question.id,
            computeResults(scoringModel, questionCandidates, includedBallots),
          ] as const;
        }
        if (resultsReveal === "live") {
          return [
            question.id,
            computeResults(scoringModel, questionCandidates, questionBallots),
          ] as const;
        }
        return [
          question.id,
          applyResultsReveal(resultsReveal, revealStep, questionFull),
        ] as const;
      }),
    );
  }, [
    hasQuestions,
    contestQuestions,
    resultsCandidates,
    resultsBallots,
    fullResultRowsByQuestion,
    resultsReveal,
    revealStep,
    eligibleVoters,
    scoringModel,
  ]);

  const liveBallotCount =
    resultsReveal === "by_participant"
      ? Math.min(Math.max(0, revealStep), eligibleVoters.length)
      : ballotCount;
  /**
   * Results overview turnout:
   * - live / open voting: how many eligible participants already voted
   * - by_participant: how many ballots are already included in the shown ranking
   */
  const votingTurnoutLabel = (() => {
    if (resultsReveal === "by_participant") {
      const total =
        eligibleVoters.length > 0
          ? eligibleVoters.length
          : ballotTotal != null && ballotTotal > 0
            ? ballotTotal
            : votesTotal;
      if (total < 1) return null;
      const reflected = Math.min(Math.max(0, liveBallotCount), total);
      return `${reflected} of ${total} ballot${total === 1 ? "" : "s"} reflected in results`;
    }
    if (votesTotal < 1) return null;
    if (showLiveResults || meta.status === "voting" || meta.status === "finished") {
      return `${votesCompleted} of ${votesTotal} participant${votesTotal === 1 ? "" : "s"} have voted`;
    }
    return null;
  })();
  const votingResultsStatus = votingResultsStatusKind({
    showLiveResults,
    resultsComplete,
  });
  const votingResultsDescription = (
    <>
      <PresentationStatusLabel kind={votingResultsStatus}>
        {votingResultsStatusText(votingResultsStatus)}
      </PresentationStatusLabel>
      {votingTurnoutLabel ? (
        <>
          {" · "}
          <span className="tabular-nums text-muted-foreground">
            {votingTurnoutLabel}
          </span>
        </>
      ) : null}
    </>
  );
  const votingTopicsSuffix =
    hasQuestions && contestQuestions.length > 0
      ? ` · ${contestQuestions.length} topic${contestQuestions.length === 1 ? "" : "s"}`
      : "";
  const votingOpenDescription = (
    <>
      <span className="font-medium text-emerald-700 dark:text-emerald-400">
        Voting open
      </span>
      {votingTopicsSuffix}
    </>
  );

  const liveResultAfterPresenters = useMemo(() => {
    if (resultsReveal !== "by_participant" || revealStep <= 0) {
      return resultAfterPresenters ?? null;
    }
    const included = eligibleVoters.slice(0, revealStep);
    if (included.length === 0) {
      return resultAfterPresenters ?? null;
    }
    return included.map((voter, index) => ({
      userId: voter.userId,
      displayName: resultsAnonymous
        ? anonymousParticipantLabel(index)
        : voter.displayName,
    }));
  }, [
    resultsReveal,
    revealStep,
    eligibleVoters,
    resultAfterPresenters,
    resultsAnonymous,
  ]);

  // Keep subtitle only for non–ballot-by-ballot copy from the server.
  const liveResultsSubtitle =
    resultsReveal === "by_participant" ? null : resultsSubtitle;
  const latestBallotDeltaByCandidateId = useMemo(() => {
    // After finish presentation, show totals only — hide the last ballot delta.
    if (phase === "done") return undefined;
    if (resultsReveal !== "by_participant" || revealStep <= 0) {
      return undefined;
    }
    const lastVoter = eligibleVoters[revealStep - 1];
    if (!lastVoter) return undefined;
    const ballot = resultsBallots.find(
      (row) => row.voterUserId === lastVoter.userId,
    );
    if (!ballot) return undefined;
    return pointsByCandidateFromBallot(
      scoringModel,
      ballot.rankings,
      resultsCandidates.length,
      ballot.ratings,
    );
  }, [
    phase,
    resultsReveal,
    revealStep,
    eligibleVoters,
    resultsBallots,
    scoringModel,
    resultsCandidates.length,
  ]);

  const presentationStatus = resultsPresentationStatusKind({
    phase,
    resultsReveal,
    candidateComplete: resultsComplete,
    nominatorComplete,
  });
  const nominatorStatus = nominatorResultsStatusKind(
    nominatorComplete || nomMode === "immediate",
  );
  const nominatorResultsDescription = (
    <PresentationStatusLabel kind={nominatorStatus}>
      {nominatorResultsStatusText(nominatorStatus)}
    </PresentationStatusLabel>
  );

  const nextBallotPresenter: BallotPresenter | null =
    resultsReveal === "by_participant" &&
    phase === "candidates" &&
    !resultsComplete
      ? (() => {
          const voter = eligibleVoters[revealStep];
          if (!voter) return null;
          return {
            userId: voter.userId,
            displayName: resultsAnonymous
              ? anonymousParticipantLabel(revealStep)
              : voter.displayName.trim(),
          };
        })()
      : null;

  const myBallotCountedStatus = useMemo(() => {
    if (!submittedAnyQuestion || !currentUserId) return null;
    if (!showResults) return null;
    if (resultsReveal === "by_participant") {
      const myIndex = eligibleVoters.findIndex(
        (voter) => voter.userId === currentUserId,
      );
      if (myIndex < 0) return null;
      return myIndex < revealStep ? "Already counted" : "Not counted yet";
    }
    // Instant / place reveal: all ballots are in the score from the start.
    return "Already counted";
  }, [
    submittedAnyQuestion,
    currentUserId,
    showResults,
    resultsReveal,
    eligibleVoters,
    revealStep,
  ]);

  const liveSpotifyByCandidateId = useMemo(() => {
    const map: Record<string, { url: string; uri?: string | null }> = {
      ...spotifyByCandidateId,
    };
    for (const candidate of liveCandidates) {
      if (candidate.spotify_url) {
        map[candidate.id] = {
          url: candidate.spotify_url,
          uri: candidate.spotify_uri ?? map[candidate.id]?.uri ?? null,
        };
      }
    }
    return map;
  }, [spotifyByCandidateId, liveCandidates]);

  const liveNominatorResultRows = useMemo(() => {
    if (!nominatorRanking || !nominatorRankingContext) return [];
    if (nominatorRankingWhen === "parallel") {
      return computeNominatorResults(
        liveResultRows,
        nominatorComputeCandidates,
        nominatorNameByKey,
        nominatorRankingContext,
      );
    }
    return applyResultsReveal(nomMode, meta.nominatorRevealStep, nominatorFullRows);
  }, [
    nominatorRanking,
    nominatorRankingContext,
    nominatorRankingWhen,
    liveResultRows,
    nominatorComputeCandidates,
    nominatorNameByKey,
    nomMode,
    meta.nominatorRevealStep,
    nominatorFullRows,
  ]);

  const hostNextAction = resolveHostNextAction({
    status: meta.status,
    nominationsOpen: meta.nominationsOpen,
    votingOpen: meta.votingOpen,
    needsAdminReveal,
    pendingRevealCount: needsAdminReveal ? livePendingRevealCount : 0,
    candidateCount: liveCandidateCount,
    resultsPhase: phase,
    curatedOnly:
      candidateSource === "curated" && nominationKind !== "birthday",
  });

  function hostStepTitle(label: string, status: ReactNode) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span>{label}</span>
        {status}
      </span>
    );
  }

  const nominationsTitleStatus = (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5 text-xs font-medium">
      <ColoredNominationStatus
        open={meta.nominationsOpen}
        nominationDeadline={meta.nominationDeadline ?? nominationDeadline}
        nominationDurationSeconds={nominationDurationSeconds}
        openLabel="open"
        closedLabel="closed"
        notStartedLabel="not started yet"
        compact
      />
      {nominationsTotal > 0 &&
      !isNominationsNotStartedYet({
        nominationsOpen: meta.nominationsOpen,
        nominationDurationSeconds,
        nominationDeadline: meta.nominationDeadline ?? nominationDeadline,
      }) ? (
        <span className="text-muted-foreground tabular-nums">
          · {nominationsCompleted}/{nominationsTotal} nominations completed
        </span>
      ) : null}
    </span>
  );

  const revealProgress = countCandidateRevealProgress(liveActiveCandidates);
  const revealStatusKind = resolveCandidateRevealStatus({
    needsAdminReveal,
    pendingCount: revealProgress.pendingCount,
    revealedCount: revealProgress.revealedCount,
    votingOrLater: meta.status === "voting" || meta.status === "finished",
  });
  const revealTitleStatus = (
    <ColoredCandidateRevealStatus
      kind={revealStatusKind}
      revealedCount={revealProgress.revealedCount}
      totalCount={revealProgress.totalCount}
      variant="compact"
    />
  );

  const votingTitleStatus =
    meta.status === "open" && !meta.votingOpen ? (
      <span className="text-xs font-medium text-muted-foreground">
        not started
      </span>
    ) : (
      <span className="inline-flex flex-wrap items-baseline gap-x-1.5 text-xs font-medium">
        <ColoredVotingStatus
          votingOpen={meta.votingOpen && meta.status === "voting"}
          votingClosesAt={countdownClosesAt}
          votingReopenedAt={meta.votingReopenedAt}
          labelPrefix="Voting"
          compact
        />
        {votesTotal > 0 &&
        (meta.status === "voting" || meta.status === "finished") ? (
          <span className="text-muted-foreground tabular-nums">
            · {votesCompleted}/{votesTotal} votes completed
          </span>
        ) : null}
      </span>
    );

  const resultsTitleStatus = (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5 text-xs font-medium">
      <PresentationStatusLabel kind={presentationStatus}>
        {resultsPresentationStatusText(presentationStatus, phase)}
      </PresentationStatusLabel>
      {votingTurnoutLabel ? (
        <span className="text-muted-foreground tabular-nums">
          · {votingTurnoutLabel}
        </span>
      ) : null}
    </span>
  );

  const hostPanels = showHostPanels && isHost ? (
    <div className="space-y-4">
      <CollapsibleCard
        sectionId="nominations"
        persist={false}
        defaultOpen={
          hostNextAction === "close_nominations" ||
          hostNextAction === "open_nominations"
        }
        className={cn(
          (hostNextAction === "close_nominations" ||
            hostNextAction === "open_nominations") &&
            "ring-2 ring-primary/35",
        )}
        title={hostStepTitle("Nominations", nominationsTitleStatus)}
        description={
          meta.nominationsOpen ? (
            <>
              Close nominations anytime. They also close automatically when you
              start voting
              {needsAdminReveal ? " or release candidates" : ""}
              {nominationDeadline
                ? ", or when the nomination deadline passes"
                : ""}
              .
            </>
          ) : meta.status === "open" ? (
            "You can reopen nominations before voting starts."
          ) : (
            "Nominations stay closed once voting has started — expand to review status."
          )
        }
        contentClassName="space-y-3"
      >
        <HostTabLinkPrompt
          show={
            hostParticipates &&
            showNominateTab &&
            meta.nominationsOpen &&
            !hostHasNominated
          }
          tab="nominate"
          tabLabel="Nominate"
        >
          You participate as a nominator — open
        </HostTabLinkPrompt>
        {meta.nominationsOpen ? (
          <CloseNominationsButton
            contestId={contestId}
            joinCode={joinCode}
            nominationDeadline={meta.nominationDeadline ?? nominationDeadline}
            emphasized={hostNextAction === "close_nominations"}
          />
        ) : meta.status === "open" ? (
          <OpenNominationsButton
            contestId={contestId}
            joinCode={joinCode}
            nominationDurationSeconds={nominationDurationSeconds}
            emphasized={hostNextAction === "open_nominations"}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Nominations are closed
            {meta.status === "voting"
              ? " while voting is underway"
              : meta.status === "finished"
                ? " — contest finished"
                : ""}
            . Reopen is only available before voting starts.
          </p>
        )}
      </CollapsibleCard>

      {showRevealControls ? (
        <CollapsibleCard
          sectionId="reveal-candidates"
          persist={false}
          defaultOpen={hostNextAction === "reveal_candidates"}
          className={cn(
            hostNextAction === "reveal_candidates" && "ring-2 ring-primary/35",
          )}
          title={hostStepTitle("Reveal candidates", revealTitleStatus)}
          description={
            meta.status === "open" && !meta.votingOpen
              ? "Release the full list when you are ready."
              : "Review reveal progress — expand anytime."
          }
        >
          <HostRevealControls
            contestId={contestId}
            joinCode={joinCode}
            revealMode={revealMode}
            candidateSort={candidateSort}
            candidates={revealCandidates}
            nominationsOpen={meta.nominationsOpen}
            curatedEntries={curatedBirthdayEntries}
            isCuratedBirthday={isCuratedBirthdayContest(
              nominationKind,
              candidateSource,
            )}
            emphasized={hostNextAction === "reveal_candidates"}
          />
        </CollapsibleCard>
      ) : null}

      <CollapsibleCard
        sectionId="voting-controls"
        persist={false}
        defaultOpen={
          hostNextAction === "start_voting" ||
          hostNextAction === "close_voting"
        }
        className={cn(
          (hostNextAction === "start_voting" ||
            hostNextAction === "close_voting") &&
            "ring-2 ring-primary/35",
        )}
        title={hostStepTitle("Voting controls", votingTitleStatus)}
        description="Open and close the voting phase for this contest."
      >
        <div className="space-y-3">
          <HostTabLinkPrompt
            show={
              hostParticipates &&
              meta.votingOpen &&
              meta.status === "voting" &&
              !hostVoteSubmitted
            }
            tab="candidates"
            tabLabel="Voting"
            emphasized
          >
            You participate as a voter — cast your ballot now.
          </HostTabLinkPrompt>
          <HostVotingControls
            contestId={contestId}
            joinCode={joinCode}
            status={meta.status}
            votingOpen={meta.votingOpen}
            candidateCount={liveCandidateCount}
            pendingRevealCount={needsAdminReveal ? livePendingRevealCount : 0}
            votingCloseMode={liveVotingCloseMode}
            votingClosesAt={liveVotingClosesAt}
            votingReopenedAt={meta.votingReopenedAt}
            resultsPhase={meta.resultsPhase}
            resultsReveal={resultsReveal}
            resultsRevealStep={meta.resultsRevealStep}
            nominatorRevealStep={meta.nominatorRevealStep}
            emphasizedAction={
              hostNextAction === "start_voting" ||
              hostNextAction === "close_voting"
                ? hostNextAction
                : null
            }
          />
        </div>
      </CollapsibleCard>

      {meta.status === "finished" ? (
        <CollapsibleCard
          id="results-presentation"
          sectionId="results-presentation"
          persist={false}
          defaultOpen
          className={cn(
            hostNextAction === "advance_results" && "ring-2 ring-primary/35",
          )}
          title={hostStepTitle("Results presentation", resultsTitleStatus)}
          description={
            nominatorRanking
              ? `Nominator ranking ${nominatorRankingWhen} candidates.`
              : undefined
          }
        >
          <HostResultsControls
            contestId={contestId}
            joinCode={joinCode}
            resultsReveal={resultsReveal}
            resultsPhase={phase}
            nominatorRanking={nominatorRanking}
            nominatorRankingWhen={nominatorRankingWhen}
            nominatorResultsReveal={nominatorResultsReveal}
            candidateStep={revealStep}
            candidateMaxStep={resultsMaxStep}
            candidateComplete={resultsComplete}
            nominatorStep={meta.nominatorRevealStep}
            nominatorMaxStep={nominatorMaxStep}
            nominatorComplete={nominatorComplete}
            pendingPhotoDeleteCount={pendingPhotoDeleteCount}
            emphasized={hostNextAction === "advance_results"}
          />
        </CollapsibleCard>
      ) : null}
    </div>
  ) : null;

  const yourBallotTitle =
    contestQuestions.length > 1 ? "Your ballots" : "Your ballot";

  if (panelMode === "host") {
    return hostPanels;
  }

  return (
    <div className="space-y-4">
      {panelMode === "all" ? hostPanels : null}

      {showWaitingForVoting ? (
        <p className="rounded-lg border border-dashed px-3 py-2 text-sm">
          {isHost
            ? isStarRatingModel(scoringModel)
              ? "Candidates are ready. Start voting when you want star ratings to open."
              : isBestOnlyModel(scoringModel)
                ? "Candidates are ready. Start voting when you want picks to open."
                : "Candidates are ready. Start voting when you want ballots to open."
            : "Voting is not open yet — wait for the host to start voting."}
        </p>
      ) : null}

      {meta.status === "voting" &&
      meta.votingOpen &&
      isHost &&
      hostParticipates === false ? (
        <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
          You are admin-only for this contest, so you cannot cast a ballot.
          Turnout is listed under Participants.
        </p>
      ) : null}

      {showResults ? (
        <div className="space-y-4">
          {nominatorRankingWhen === "before" ? (
            <>
              {showNominatorBlock ? (
                <CollapsibleCard
                  sectionId="nominator-ranking"
                  persist={false}
                  defaultOpen
                  title="Nominator ranking"
                  description={nominatorResultsDescription}
                >
                  <NominatorResults
                    results={liveNominatorResultRows}
                    waiting={
                      isSteppedPlaceReveal(nomMode) &&
                      meta.nominatorRevealStep <= 0 &&
                      liveNominatorResultRows.length === 0
                    }
                  />
                </CollapsibleCard>
              ) : null}

              {showCandidateBlock ? (
                <CollapsibleCard
                  sectionId="candidate-results"
                  persist={false}
                  defaultOpen
                  title="Voting results"
                  description={votingResultsDescription}
                  contentClassName="space-y-4"
                >
                  {ballotsErrorMessage ? (
                    <p className="text-sm text-muted-foreground">
                      Run SQL migrations 016–022 to enable results. (
                      {ballotsErrorMessage})
                    </p>
                  ) : hasQuestions ? (
                    <div className="space-y-6">
                      {contestQuestions.map((question) => {
                        const rows = liveResultRowsByQuestion[question.id] ?? [];
                        return (
                          <div key={question.id} className="space-y-2">
                            <ContestResults
                              results={rows}
                              ballotCount={liveBallotCount}
                              ballotTotal={ballotTotal}
                              theme={theme}
                              scoringLabel={
                                SCORING_MODELS[scoringModel]?.label ?? scoringModel
                              }
                              subtitle={liveResultsSubtitle}
                              resultAfterPresenters={liveResultAfterPresenters}
                              birthdayLabelsByCandidateId={visibleBirthdayLabels}
                              latestBallotDeltaByCandidateId={
                                latestBallotDeltaByCandidateId
                              }
                              photoNumberByCandidateId={photoNumberById}
                              nextBallotPresenter={nextBallotPresenter}
                              currentUserId={currentUserId}
                              contestId={contestId}
                              isHost={isHost}
                              songLinks={songLinks}
                              spotifyByCandidateId={liveSpotifyByCandidateId}
                              showStarPoints={showStarPoints}
                              waiting={
                                !isInstantResultsReveal(resultsReveal) &&
                                revealStep <= 0 &&
                                rows.length === 0
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <ContestResults
                      results={liveResultRows}
                      ballotCount={liveBallotCount}
                      ballotTotal={ballotTotal}
                      theme={theme}
                      scoringLabel={
                        SCORING_MODELS[scoringModel]?.label ?? scoringModel
                      }
                      subtitle={liveResultsSubtitle}
                      resultAfterPresenters={liveResultAfterPresenters}
                      birthdayLabelsByCandidateId={visibleBirthdayLabels}
                      latestBallotDeltaByCandidateId={
                        latestBallotDeltaByCandidateId
                      }
                      photoNumberByCandidateId={photoNumberById}
                      nextBallotPresenter={nextBallotPresenter}
                      currentUserId={currentUserId}
                      contestId={contestId}
                      isHost={isHost}
                      songLinks={songLinks}
                      spotifyByCandidateId={liveSpotifyByCandidateId}
                      showStarPoints={showStarPoints}
                      waiting={
                        !isInstantResultsReveal(resultsReveal) &&
                        revealStep <= 0 &&
                        liveResultRows.length === 0
                      }
                    />
                  )}
                </CollapsibleCard>
              ) : null}
            </>
          ) : (
            <>
              {showCandidateBlock ? (
                <CollapsibleCard
                  sectionId="candidate-results"
                  persist={false}
                  defaultOpen
                  title="Voting results"
                  description={votingResultsDescription}
                  contentClassName="space-y-4"
                >
                  {ballotsErrorMessage ? (
                    <p className="text-sm text-muted-foreground">
                      Run SQL migrations 016–022 to enable results. (
                      {ballotsErrorMessage})
                    </p>
                  ) : hasQuestions ? (
                    <div className="space-y-6">
                      {contestQuestions.map((question) => {
                        const rows = liveResultRowsByQuestion[question.id] ?? [];
                        return (
                          <div key={question.id} className="space-y-2">
                            <ContestResults
                              results={rows}
                              ballotCount={liveBallotCount}
                              ballotTotal={ballotTotal}
                              theme={theme}
                              scoringLabel={
                                SCORING_MODELS[scoringModel]?.label ?? scoringModel
                              }
                              subtitle={liveResultsSubtitle}
                              resultAfterPresenters={liveResultAfterPresenters}
                              birthdayLabelsByCandidateId={visibleBirthdayLabels}
                              latestBallotDeltaByCandidateId={
                                latestBallotDeltaByCandidateId
                              }
                              photoNumberByCandidateId={photoNumberById}
                              nextBallotPresenter={nextBallotPresenter}
                              currentUserId={currentUserId}
                              contestId={contestId}
                              isHost={isHost}
                              songLinks={songLinks}
                              spotifyByCandidateId={liveSpotifyByCandidateId}
                              showStarPoints={showStarPoints}
                              waiting={
                                !isInstantResultsReveal(resultsReveal) &&
                                revealStep <= 0 &&
                                rows.length === 0
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <ContestResults
                      results={liveResultRows}
                      ballotCount={liveBallotCount}
                      ballotTotal={ballotTotal}
                      theme={theme}
                      scoringLabel={
                        SCORING_MODELS[scoringModel]?.label ?? scoringModel
                      }
                      subtitle={liveResultsSubtitle}
                      resultAfterPresenters={liveResultAfterPresenters}
                      birthdayLabelsByCandidateId={visibleBirthdayLabels}
                      latestBallotDeltaByCandidateId={
                        latestBallotDeltaByCandidateId
                      }
                      photoNumberByCandidateId={photoNumberById}
                      nextBallotPresenter={nextBallotPresenter}
                      currentUserId={currentUserId}
                      contestId={contestId}
                      isHost={isHost}
                      songLinks={songLinks}
                      spotifyByCandidateId={liveSpotifyByCandidateId}
                      showStarPoints={showStarPoints}
                      waiting={
                        !isInstantResultsReveal(resultsReveal) &&
                        revealStep <= 0 &&
                        liveResultRows.length === 0
                      }
                    />
                  )}
                </CollapsibleCard>
              ) : null}

              {showNominatorBlock ? (
                <CollapsibleCard
                  sectionId="nominator-ranking"
                  persist={false}
                  defaultOpen
                  title="Nominator ranking"
                  description={nominatorResultsDescription}
                >
                  <NominatorResults
                    results={liveNominatorResultRows}
                    waiting={
                      isSteppedPlaceReveal(nomMode) &&
                      meta.nominatorRevealStep <= 0 &&
                      liveNominatorResultRows.length === 0
                    }
                  />
                </CollapsibleCard>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {canCastBallot &&
      !isInlineVoteModel(scoringModel) &&
      !isInlineRankChipsModel(scoringModel, liveCandidateCount) &&
      !isEmbeddedBallotModel(scoringModel, liveCandidateCount) ? (
        <CollapsibleCard
          sectionId="your-ballot"
          persist={false}
          defaultOpen
          title={yourBallotTitle}
          contentClassName="space-y-4"
        >
          {countdownClosesAt ? votingStatusBadge : null}
          {hasQuestions ? (
            contestQuestions.map((question) => {
              const questionCandidates = candidatesForQuestion(
                liveBallotCandidates,
                question.id,
              );
              const rankings = myRankingsByQuestion[question.id] ?? null;
              const locked =
                Boolean(rankings?.length) &&
                (voteMutability === "locked_on_submit" || !canCastBallot);
              return (
                <VotingBallot
                  key={question.id}
                  contestId={contestId}
                  joinCode={joinCode}
                  scoringModel={scoringModel}
                  theme={theme}
                  candidates={questionCandidates}
                  excludedCandidateIds={excludedCandidateIds}
                  existingRankings={rankings}
                  locked={locked}
                  voteMutability={voteMutability}
                  allowEdit={canCastBallot}
                  votingClosesAt={countdownClosesAt}
                  questionId={question.id}
                  hideQuestionTitle
                  hideIntro
                />
              );
            })
          ) : (
            <VotingBallot
              contestId={contestId}
              joinCode={joinCode}
              scoringModel={scoringModel}
              theme={theme}
              candidates={liveBallotCandidates}
              excludedCandidateIds={excludedCandidateIds}
              existingRankings={myRankings}
              locked={ballotLocked}
              voteMutability={voteMutability}
              allowEdit={canCastBallot}
              votingClosesAt={countdownClosesAt}
              hideIntro
            />
          )}
        </CollapsibleCard>
      ) : null}

      {!canCastBallot &&
      showMyBallot &&
      isRankingBallotModel(scoringModel) ? (
        <CollapsibleCard
          sectionId="your-ballot"
          persist={false}
          defaultOpen
          title={yourBallotTitle}
          description={
            missedDeadline
              ? "Voting has ended for this contest."
              : (myBallotCountedStatus ?? "What you voted in this contest.")
          }
          contentClassName="space-y-4"
        >
          {votingStatusBadge}
          {hasQuestions ? (
            contestQuestions.map((question) => {
              const source =
                liveBallotCandidates.length > 0
                  ? liveBallotCandidates
                  : ballotCandidatesFallback;
              const questionCandidates = candidatesForQuestion(
                source,
                question.id,
              );
              const rankings = myRankingsByQuestion[question.id] ?? null;
              return (
                <VotingBallot
                  key={question.id}
                  contestId={contestId}
                  joinCode={joinCode}
                  scoringModel={scoringModel}
                  theme={theme}
                  candidates={questionCandidates}
                  excludedCandidateIds={excludedCandidateIds}
                  existingRankings={rankings}
                  locked
                  voteMutability={voteMutability}
                  allowEdit={false}
                  missedDeadline={missedDeadline && !rankings?.length}
                  questionId={question.id}
                  hideQuestionTitle
                  hideIntro
                />
              );
            })
          ) : (
            <VotingBallot
              contestId={contestId}
              joinCode={joinCode}
              scoringModel={scoringModel}
              theme={theme}
              candidates={
                liveBallotCandidates.length
                  ? liveBallotCandidates
                  : ballotCandidatesFallback
              }
              excludedCandidateIds={excludedCandidateIds}
              existingRankings={myRankings}
              locked
              voteMutability={voteMutability}
              allowEdit={false}
              missedDeadline={missedDeadline}
              hideIntro
            />
          )}
        </CollapsibleCard>
      ) : null}
    </div>
  );
}
