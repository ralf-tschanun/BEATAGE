"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, TrophyIcon } from "@phosphor-icons/react";
import { EditCandidateControls } from "@/components/edit-candidate-controls";
import {
  applyCandidateLivePatch,
  broadcastContestResync,
  subscribeContestCandidates,
  subscribeContestMeta,
  type LiveCandidateRow,
} from "@/components/contest-live-refresh";
import { NominateCandidateForm } from "@/components/nominate-candidate-form";
import { BirthdayNominateForm } from "@/components/birthday-nominate-form";
import {
  CuratedBirthdayForm,
  type CuratedBirthdayEntryRow,
} from "@/components/curated-birthday-form";
import { SongPreviewPlayer } from "@/components/song-preview-player";
import { SpotifyTrackLink } from "@/components/spotify-track-link";
import { PhotoCandidateImage, CandidateUrlPreview } from "@/components/photo-candidate-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ChartCountry } from "@/lib/charts";
import { formatBirthdayOffsetLabel } from "@/lib/birthday-offset";
import { StarRatingInput } from "@/components/star-rating";
import {
  getBallotSlotCount,
  isBestOnlyModel,
  isCuratedBirthdayContest,
  isInlineRankChipsModel,
  isParticipantNomination,
  isStarRatingModel,
  sortCandidates,
  type CandidateSort,
  type CandidateSource,
  type ContestTheme,
  type NominationKind,
  type ScoringModelId,
  type SongLinksMode,
  type VoteMutability,
} from "@/lib/plans";
import { isContestImageUrl } from "@/lib/contest-photos";
import { formatPhotoLabel, photoNumberByCandidateId } from "@/lib/photo-labels";
import { cn } from "@/lib/utils";
import {
  castBallotAction,
  resolveMissingSpotifyLinksAction,
} from "@/app/actions/contest";

export type CandidatesListItem = LiveCandidateRow;

export type RemovedCandidateRow = {
  id: string;
  candidateId: string;
  title: string;
  artist: string | null;
  url: string | null;
  description: string | null;
  nominatorDisplayName: string;
  removedAt: string | null;
};

type CandidatesListProps = {
  contestId: string;
  joinCode: string;
  initialCandidates: CandidatesListItem[];
  currentUserId: string;
  isHost: boolean;
  theme: ContestTheme;
  candidateSort: CandidateSort;
  nominationsOpen: boolean;
  nominationDeadline?: string | null;
  nominationsReopenedAt?: string | null;
  needsAdminReveal: boolean;
  /** Pending candidates hidden until nominations close (or admin reveal). */
  deferredCandidateReveal?: boolean;
  /** Song contests: preview / spotify / none */
  songLinks?: SongLinksMode;
  memberNameByUserId: Record<string, string>;
  canShowNominateForm?: boolean;
  /** Eligibility to nominate (independent of open/closed). */
  canNominateEligible?: boolean;
  remainingNominations?: number | null;
  /** 1-based index of the nomination currently being entered (e.g. 1, 7). */
  nextNominationNumber?: number;
  nominateMode?: "user" | "curated";
  nominationKind?: NominationKind;
  candidateSource?: CandidateSource;
  chartCountry?: ChartCountry;
  curatedBirthdayEntries?: CuratedBirthdayEntryRow[];
  remainingCuratedEntries?: number | null;
  birthdayAlreadySubmitted?: boolean;
  birthdayHadChartMatch?: boolean | null;
  initialBirthday?: string | null;
  initialShowBirthday?: boolean;
  birthdayDateOffset?: { amount: number; unit: "months" | "years" };
  linkedNominatorNamesByCandidateId?: Record<string, string[]>;
  /** Host-only: curated entry name + birth year per candidate (never shown to participants). */
  hostCuratedLabelsByCandidateId?: Record<string, string[]>;
  /** Birthday contests: show who the hit belongs to only after final results. */
  revealBirthdayIdentities?: boolean;
  /** When true, list who nominated each candidate (participant nomination contests). */
  showNominees?: boolean;
  hostUserId?: string | null;
  /** Ballot prompt(s), shown above nominations so participants know what to enter. */
  topics?: string[];
  /** Noun for generic nomination fields. */
  candidateTitleLabel?: string;
  scoringModel?: ScoringModelId;
  initialStatus?: string;
  initialVotingOpen?: boolean;
  canRate?: boolean;
  /** True when this participant may pick a best-only favorite on the list. */
  canPickBest?: boolean;
  /** True when this participant may assign Best 2–4 ranks on the list. */
  canRankInline?: boolean;
  excludedCandidateIds?: string[];
  initialRatings?: Record<string, number>;
  /** True when this participant already submitted a star-rating ballot. */
  initialRatingsSubmitted?: boolean;
  /** questionKey → selected candidate id for best-only voting. */
  initialBestPicks?: Record<string, string>;
  /** True when this participant already submitted a best-only pick. */
  initialBestPicksSubmitted?: boolean;
  /** questionKey → ordered candidate ids for inline Best 2–4 ranking. */
  initialRankingsByQuestion?: Record<string, string[]>;
  /** True when this participant already submitted an inline ranking ballot. */
  initialRankingsSubmitted?: boolean;
  voteMutability?: VoteMutability;
  /** Topic id used when candidates themselves have no question_id. */
  defaultRatingQuestionId?: string | null;
  /** Host-only archive of candidates removed with a kicked participant. */
  removedCandidates?: RemovedCandidateRow[];
};

function isVisibleToViewer(
  candidate: CandidatesListItem,
  isHost: boolean,
  currentUserId: string,
  nominationKind: NominationKind,
) {
  if (candidate.status === "withdrawn" || candidate.status === "rejected") {
    return false;
  }
  if (isHost) return true;
  // Birthday mode: participants never see songs until host reveals them
  if (nominationKind === "birthday") {
    return candidate.status === "visible" || candidate.status === "in_voting";
  }
  if (candidate.nominator_user_id === currentUserId) return true;
  return candidate.status === "visible" || candidate.status === "in_voting";
}

export function CandidatesList({
  contestId,
  joinCode,
  initialCandidates,
  currentUserId,
  isHost,
  theme,
  candidateSort,
  nominationsOpen,
  nominationDeadline = null,
  nominationsReopenedAt = null,
  needsAdminReveal,
  deferredCandidateReveal = false,
  songLinks = "preview",
  memberNameByUserId,
  canShowNominateForm = false,
  canNominateEligible = false,
  remainingNominations = null,
  nextNominationNumber = 1,
  nominateMode = "user",
  nominationKind = "standard",
  candidateSource = "user_single",
  chartCountry = "US",
  curatedBirthdayEntries = [],
  remainingCuratedEntries = null,
  birthdayAlreadySubmitted = false,
  birthdayHadChartMatch = null,
  initialBirthday = null,
  initialShowBirthday = false,
  birthdayDateOffset = { amount: 0, unit: "years" },
  linkedNominatorNamesByCandidateId = {},
  hostCuratedLabelsByCandidateId = {},
  revealBirthdayIdentities = false,
  hostUserId = null,
  showNominees = false,
  topics = [],
  candidateTitleLabel = "Candidate",
  scoringModel = "linear_x",
  initialStatus = "open",
  initialVotingOpen = false,
  canRate = false,
  canPickBest = false,
  canRankInline = false,
  excludedCandidateIds = [],
  initialRatings = {},
  initialRatingsSubmitted = false,
  initialBestPicks = {},
  initialBestPicksSubmitted = false,
  initialRankingsByQuestion = {},
  initialRankingsSubmitted = false,
  voteMutability = "editable_until_close",
  defaultRatingQuestionId = null,
  removedCandidates: initialRemovedCandidates = [],
}: CandidatesListProps) {
  const router = useRouter();
  const [candidates, setCandidates] = useState(initialCandidates);
  const [removedCandidates, setRemovedCandidates] = useState(
    initialRemovedCandidates,
  );
  const [nominationsOpenLive, setNominationsOpenLive] = useState(nominationsOpen);
  const [statusLive, setStatusLive] = useState(initialStatus);
  const [votingOpenLive, setVotingOpenLive] = useState(initialVotingOpen);
  const [ratings, setRatings] = useState<Record<string, number>>(initialRatings);
  const [ratingsSubmitted, setRatingsSubmitted] = useState(initialRatingsSubmitted);
  /** Last successfully submitted ratings — used to detect dirty edits and Cancel. */
  const [submittedRatings, setSubmittedRatings] = useState<Record<
    string,
    number
  > | null>(() => (initialRatingsSubmitted ? { ...initialRatings } : null));
  const [ratingsEditing, setRatingsEditing] = useState(
    !(initialRatingsSubmitted && voteMutability === "locked_on_submit"),
  );
  const [bestPicks, setBestPicks] = useState<Record<string, string>>(initialBestPicks);
  const [bestPicksSubmitted, setBestPicksSubmitted] = useState(
    initialBestPicksSubmitted,
  );
  const [submittedBestPicks, setSubmittedBestPicks] = useState<Record<
    string,
    string
  > | null>(() =>
    initialBestPicksSubmitted ? { ...initialBestPicks } : null,
  );
  const [bestPicksEditing, setBestPicksEditing] = useState(
    !(initialBestPicksSubmitted && voteMutability === "locked_on_submit"),
  );
  const [rankPicks, setRankPicks] = useState<Record<string, string[]>>(
    initialRankingsByQuestion,
  );
  const [rankPicksSubmitted, setRankPicksSubmitted] = useState(
    initialRankingsSubmitted,
  );
  const [submittedRankPicks, setSubmittedRankPicks] = useState<Record<
    string,
    string[]
  > | null>(() =>
    initialRankingsSubmitted
      ? Object.fromEntries(
          Object.entries(initialRankingsByQuestion).map(([k, v]) => [k, [...v]]),
        )
      : null,
  );
  const [rankPicksEditing, setRankPicksEditing] = useState(
    !(initialRankingsSubmitted && voteMutability === "locked_on_submit"),
  );
  const [confirmRatingsOpen, setConfirmRatingsOpen] = useState(false);
  const [confirmBestOpen, setConfirmBestOpen] = useState(false);
  const [confirmRankOpen, setConfirmRankOpen] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [bestError, setBestError] = useState<string | null>(null);
  const [rankError, setRankError] = useState<string | null>(null);
  const [ratingPending, setRatingPending] = useState(false);
  const [bestPending, setBestPending] = useState(false);
  const [rankPending, setRankPending] = useState(false);
  const ratingsRef = useRef(ratings);
  const bestPicksRef = useRef(bestPicks);
  const rankPicksRef = useRef(rankPicks);
  const candidatesRef = useRef(candidates);
  const excludedRef = useRef<Set<string>>(new Set());
  const [nominationDeadlineLive, setNominationDeadlineLive] = useState(
    nominationDeadline,
  );
  const [nominationsReopenedAtLive, setNominationsReopenedAtLive] = useState(
    nominationsReopenedAt,
  );

  useEffect(() => {
    setCandidates(initialCandidates);
  }, [initialCandidates]);

  useEffect(() => {
    setRemovedCandidates(initialRemovedCandidates);
  }, [initialRemovedCandidates]);

  // Host backfill: resolve Spotify for songs nominated before Spotify was configured.
  const spotifyBackfillStarted = useRef(false);
  useEffect(() => {
    if (!isHost || theme !== "song" || spotifyBackfillStarted.current) return;
    const missing = candidates.some(
      (candidate) =>
        candidate.status !== "withdrawn" &&
        candidate.artist &&
        !candidate.spotify_url,
    );
    if (!missing) return;
    spotifyBackfillStarted.current = true;
    void resolveMissingSpotifyLinksAction(contestId, joinCode);
  }, [isHost, theme, candidates, contestId, joinCode]);

  useEffect(() => {
    setNominationsOpenLive(nominationsOpen);
  }, [nominationsOpen]);

  useEffect(() => {
    setStatusLive(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    setVotingOpenLive(initialVotingOpen);
  }, [initialVotingOpen]);

  useEffect(() => {
    if (initialRatingsSubmitted) {
      setRatingsSubmitted(true);
      setSubmittedRatings((prev) => prev ?? { ...initialRatings });
    }
  }, [initialRatingsSubmitted, initialRatings]);

  useEffect(() => {
    if (ratingsEditing) return;
    if (Object.keys(initialRatings).length === 0) return;
    setRatings(initialRatings);
    if (ratingsSubmitted) {
      setSubmittedRatings({ ...initialRatings });
    }
  }, [initialRatings, ratingsEditing, ratingsSubmitted]);

  useEffect(() => {
    if (initialBestPicksSubmitted) {
      setBestPicksSubmitted(true);
      setSubmittedBestPicks((prev) => prev ?? { ...initialBestPicks });
    }
  }, [initialBestPicksSubmitted, initialBestPicks]);

  useEffect(() => {
    if (bestPicksEditing) return;
    if (Object.keys(initialBestPicks).length === 0) return;
    setBestPicks(initialBestPicks);
    if (bestPicksSubmitted) {
      setSubmittedBestPicks({ ...initialBestPicks });
    }
  }, [initialBestPicks, bestPicksEditing, bestPicksSubmitted]);

  useEffect(() => {
    if (initialRankingsSubmitted) {
      setRankPicksSubmitted(true);
      setSubmittedRankPicks((prev) =>
        prev ??
        Object.fromEntries(
          Object.entries(initialRankingsByQuestion).map(([k, v]) => [k, [...v]]),
        ),
      );
    }
  }, [initialRankingsSubmitted, initialRankingsByQuestion]);

  useEffect(() => {
    if (rankPicksEditing) return;
    if (Object.keys(initialRankingsByQuestion).length === 0) return;
    setRankPicks(initialRankingsByQuestion);
    if (rankPicksSubmitted) {
      setSubmittedRankPicks(
        Object.fromEntries(
          Object.entries(initialRankingsByQuestion).map(([k, v]) => [k, [...v]]),
        ),
      );
    }
  }, [initialRankingsByQuestion, rankPicksEditing, rankPicksSubmitted]);

  useEffect(() => {
    ratingsRef.current = ratings;
  }, [ratings]);

  useEffect(() => {
    bestPicksRef.current = bestPicks;
  }, [bestPicks]);

  useEffect(() => {
    rankPicksRef.current = rankPicks;
  }, [rankPicks]);

  useEffect(() => {
    setNominationDeadlineLive(nominationDeadline);
  }, [nominationDeadline]);

  useEffect(() => {
    setNominationsReopenedAtLive(nominationsReopenedAt);
  }, [nominationsReopenedAt]);

  useEffect(() => {
    return subscribeContestCandidates(contestId, (patch) => {
      setCandidates((prev) => {
        const next = applyCandidateLivePatch(prev, patch, (row) => row);
        return next ?? prev;
      });
    });
  }, [contestId]);

  useEffect(() => {
    return subscribeContestMeta(contestId, (meta) => {
      setNominationsOpenLive(meta.nominationsOpen);
      setNominationDeadlineLive(meta.nominationDeadline);
      setNominationsReopenedAtLive(meta.nominationsReopenedAt);
      setStatusLive(meta.status);
      setVotingOpenLive(meta.votingOpen);
    });
  }, [contestId]);

  const visibleCandidates = useMemo(
    () =>
      sortCandidates(
        candidates.filter((candidate) =>
          isVisibleToViewer(candidate, isHost, currentUserId, nominationKind),
        ),
        candidateSort,
      ),
    [candidates, isHost, currentUserId, candidateSort, nominationKind],
  );

  /**
   * Stepwise admin reveal: keep own still-pending nominations below a divider
   * until they are revealed into the main list.
   */
  const splitOwnPendingReveal =
    needsAdminReveal && nominationKind !== "birthday";

  const ownPendingCandidates = useMemo(() => {
    if (!splitOwnPendingReveal) return [] as typeof visibleCandidates;
    return visibleCandidates.filter(
      (candidate) =>
        candidate.nominator_user_id === currentUserId &&
        candidate.status === "pending",
    );
  }, [splitOwnPendingReveal, visibleCandidates, currentUserId]);

  const revealedCandidates = useMemo(() => {
    if (!splitOwnPendingReveal || ownPendingCandidates.length === 0) {
      return visibleCandidates;
    }
    const pendingIds = new Set(ownPendingCandidates.map((c) => c.id));
    return visibleCandidates.filter((candidate) => !pendingIds.has(candidate.id));
  }, [splitOwnPendingReveal, ownPendingCandidates, visibleCandidates]);

  const photoNumbers = useMemo(() => {
    if (theme !== "photo") return {} as Record<string, number>;
    const ordered = sortCandidates(
      candidates.filter(
        (candidate) =>
          candidate.status !== "withdrawn" && candidate.status !== "rejected",
      ),
      candidateSort,
    );
    return photoNumberByCandidateId(ordered);
  }, [theme, candidates, candidateSort]);

  const justRevealedId = useMemo(() => {
    if (!needsAdminReveal || !isHost) return null;
    let latestMs = -Infinity;
    let latestId: string | null = null;
    let tie = false;
    for (const candidate of candidates) {
      if (candidate.status !== "visible" && candidate.status !== "in_voting") {
        continue;
      }
      const raw = candidate.revealed_at;
      if (!raw) continue;
      const ms = Date.parse(raw);
      if (!Number.isFinite(ms)) continue;
      if (ms > latestMs) {
        latestMs = ms;
        latestId = candidate.id;
        tie = false;
      } else if (ms === latestMs && candidate.id !== latestId) {
        tie = true;
      }
    }
    // Batch reveal stamps the same time on everyone — no single "just revealed".
    return tie ? null : latestId;
  }, [needsAdminReveal, isHost, candidates]);

  const excludedSet = useMemo(
    () => new Set(excludedCandidateIds),
    [excludedCandidateIds],
  );
  excludedRef.current = excludedSet;
  candidatesRef.current = candidates;

  const starRatingEnabled = isStarRatingModel(scoringModel) && canRate;
  const starVotingOpen =
    starRatingEnabled && statusLive === "voting" && votingOpenLive;
  const starLocked = voteMutability === "locked_on_submit" && ratingsSubmitted;
  const canEditStars = starVotingOpen && !starLocked && ratingsEditing;

  const bestOnlyEnabled = isBestOnlyModel(scoringModel) && canPickBest;
  const bestVotingOpen =
    bestOnlyEnabled && statusLive === "voting" && votingOpenLive;
  const bestLocked = voteMutability === "locked_on_submit" && bestPicksSubmitted;
  const canEditBest = bestVotingOpen && !bestLocked && bestPicksEditing;

  const selectableVotingCount = useMemo(
    () =>
      candidates.filter(
        (candidate) =>
          (candidate.status === "in_voting" ||
            (votingOpenLive && candidate.status === "visible")) &&
          !excludedSet.has(candidate.id),
      ).length,
    [candidates, excludedSet, votingOpenLive],
  );
  const rankSlotCount = getBallotSlotCount(scoringModel, selectableVotingCount);
  const rankChipsEnabled =
    canRankInline &&
    isInlineRankChipsModel(scoringModel, selectableVotingCount);
  const rankVotingOpen =
    rankChipsEnabled && statusLive === "voting" && votingOpenLive;
  const rankLocked =
    voteMutability === "locked_on_submit" && rankPicksSubmitted;
  const canEditRanks = rankVotingOpen && !rankLocked && rankPicksEditing;

  const rateableCandidateIds = useMemo(() => {
    if (!starVotingOpen) return [] as string[];
    return candidates
      .filter(
        (candidate) =>
          (candidate.status === "in_voting" ||
            candidate.status === "visible") &&
          !excludedSet.has(candidate.id),
      )
      .map((candidate) => candidate.id);
  }, [starVotingOpen, candidates, excludedSet]);

  const ratingsDirty = useMemo(() => {
    if (!ratingsSubmitted || !submittedRatings) return false;
    for (const id of rateableCandidateIds) {
      if ((ratings[id] ?? 0) !== (submittedRatings[id] ?? 0)) return true;
    }
    return false;
  }, [ratingsSubmitted, submittedRatings, rateableCandidateIds, ratings]);

  function questionKeyForCandidate(candidate: CandidatesListItem): string {
    return candidate.question_id ?? defaultRatingQuestionId ?? "";
  }

  const bestQuestionKeys = useMemo(() => {
    if (!bestVotingOpen) return [] as string[];
    const keys = new Set<string>();
    for (const candidate of candidates) {
      if (
        candidate.status !== "in_voting" &&
        !(votingOpenLive && candidate.status === "visible")
      ) {
        continue;
      }
      if (excludedSet.has(candidate.id)) continue;
      keys.add(questionKeyForCandidate(candidate));
    }
    return keys.size > 0 ? [...keys] : [defaultRatingQuestionId ?? ""];
  }, [
    bestVotingOpen,
    candidates,
    excludedSet,
    defaultRatingQuestionId,
    votingOpenLive,
  ]);

  const bestPicksDirty = useMemo(() => {
    if (!bestPicksSubmitted || !submittedBestPicks) return false;
    for (const key of bestQuestionKeys) {
      if ((bestPicks[key] ?? "") !== (submittedBestPicks[key] ?? "")) return true;
    }
    return false;
  }, [bestPicksSubmitted, submittedBestPicks, bestQuestionKeys, bestPicks]);

  const bestPicksComplete = useMemo(() => {
    for (const key of bestQuestionKeys) {
      const hasEligible = candidates.some(
        (candidate) =>
          (candidate.status === "in_voting" ||
            (votingOpenLive && candidate.status === "visible")) &&
          !excludedSet.has(candidate.id) &&
          questionKeyForCandidate(candidate) === key,
      );
      if (!hasEligible) continue;
      if (!bestPicks[key]) return false;
    }
    return bestQuestionKeys.length > 0;
  }, [
    bestQuestionKeys,
    candidates,
    excludedSet,
    bestPicks,
    defaultRatingQuestionId,
    votingOpenLive,
  ]);

  const selectedBestIds = useMemo(
    () => new Set(Object.values(bestPicks).filter(Boolean)),
    [bestPicks],
  );

  const rankQuestionKeys = useMemo(() => {
    if (!rankVotingOpen) return [] as string[];
    const keys = new Set<string>();
    for (const candidate of candidates) {
      if (
        candidate.status !== "in_voting" &&
        !(votingOpenLive && candidate.status === "visible")
      ) {
        continue;
      }
      if (excludedSet.has(candidate.id)) continue;
      keys.add(questionKeyForCandidate(candidate));
    }
    return keys.size > 0 ? [...keys] : [defaultRatingQuestionId ?? ""];
  }, [
    rankVotingOpen,
    candidates,
    excludedSet,
    defaultRatingQuestionId,
    votingOpenLive,
  ]);

  const emptyRankSlots = useMemo(
    () => Array.from({ length: rankSlotCount }, () => ""),
    [rankSlotCount],
  );

  function slotsForQuestion(key: string): string[] {
    const current = rankPicks[key];
    if (current && current.length === rankSlotCount) return current;
    return Array.from(
      { length: rankSlotCount },
      (_, index) => current?.[index] ?? "",
    );
  }

  const rankPicksDirty = useMemo(() => {
    if (!rankPicksSubmitted || !submittedRankPicks) return false;
    for (const key of rankQuestionKeys) {
      const a = slotsForQuestion(key);
      const b = submittedRankPicks[key] ?? emptyRankSlots;
      if (a.length !== b.length) return true;
      if (a.some((id, index) => id !== (b[index] ?? ""))) return true;
    }
    return false;
  }, [
    rankPicksSubmitted,
    submittedRankPicks,
    rankQuestionKeys,
    rankPicks,
    emptyRankSlots,
    rankSlotCount,
  ]);

  const rankPicksComplete = useMemo(() => {
    for (const key of rankQuestionKeys) {
      const hasEligible = candidates.some(
        (candidate) =>
          (candidate.status === "in_voting" ||
            (votingOpenLive && candidate.status === "visible")) &&
          !excludedSet.has(candidate.id) &&
          questionKeyForCandidate(candidate) === key,
      );
      if (!hasEligible) continue;
      const slots = slotsForQuestion(key);
      if (slots.length !== rankSlotCount || slots.some((id) => !id)) {
        return false;
      }
    }
    return rankQuestionKeys.length > 0 && rankSlotCount > 0;
  }, [
    rankQuestionKeys,
    candidates,
    excludedSet,
    rankPicks,
    rankSlotCount,
    defaultRatingQuestionId,
    votingOpenLive,
  ]);

  const candidateRankById = useMemo(() => {
    const map = new Map<string, number>();
    for (const slots of Object.values(rankPicks)) {
      slots.forEach((id, index) => {
        if (id) map.set(id, index + 1);
      });
    }
    return map;
  }, [rankPicks]);

  async function saveRatingsForQuestion(questionKey: string) {
    const eligible = candidatesRef.current.filter(
      (candidate) =>
        (candidate.status === "in_voting" ||
          candidate.status === "visible") &&
        !excludedRef.current.has(candidate.id) &&
        questionKeyForCandidate(candidate) === questionKey,
    );
    const payload: Record<string, number> = {};
    for (const candidate of eligible) {
      payload[candidate.id] = ratingsRef.current[candidate.id] ?? 0;
    }
    const fd = new FormData();
    fd.set("contestId", contestId);
    fd.set("joinCode", joinCode);
    fd.set("ratings", JSON.stringify(payload));
    if (questionKey) fd.set("questionId", questionKey);
    return castBallotAction(null, fd);
  }

  function snapshotCurrentRatings(): Record<string, number> {
    const snapshot: Record<string, number> = {};
    for (const candidate of candidatesRef.current) {
      if (candidate.status !== "in_voting") continue;
      if (excludedRef.current.has(candidate.id)) continue;
      snapshot[candidate.id] = ratingsRef.current[candidate.id] ?? 0;
    }
    return snapshot;
  }

  async function submitStarRatings() {
    setRatingError(null);
    setRatingPending(true);
    try {
      const keys = new Set<string>();
      for (const candidate of candidatesRef.current) {
        if (candidate.status !== "in_voting") continue;
        if (excludedRef.current.has(candidate.id)) continue;
        keys.add(questionKeyForCandidate(candidate));
      }
      const questionKeys = keys.size > 0 ? [...keys] : [defaultRatingQuestionId ?? ""];
      for (const key of questionKeys) {
        const result = await saveRatingsForQuestion(key);
        if (result?.error) {
          setRatingError(result.error);
          return;
        }
      }
      const snapshot = snapshotCurrentRatings();
      setSubmittedRatings(snapshot);
      setRatingsSubmitted(true);
      setConfirmRatingsOpen(false);
      if (voteMutability === "locked_on_submit") {
        setRatingsEditing(false);
      }
      void broadcastContestResync(contestId);
      router.refresh();
    } finally {
      setRatingPending(false);
    }
  }

  function cancelRatingEdits() {
    if (!submittedRatings) return;
    const restored = { ...submittedRatings };
    setRatings(restored);
    ratingsRef.current = restored;
    setRatingError(null);
  }

  function handleStarChange(candidate: CandidatesListItem, stars: number) {
    setRatings((prev) => {
      const next = { ...prev, [candidate.id]: stars };
      ratingsRef.current = next;
      return next;
    });
  }

  async function saveBestPickForQuestion(questionKey: string, candidateId: string) {
    const fd = new FormData();
    fd.set("contestId", contestId);
    fd.set("joinCode", joinCode);
    fd.set("rankings", JSON.stringify([candidateId]));
    fd.set("inline", "1");
    if (questionKey) fd.set("questionId", questionKey);
    return castBallotAction(null, fd);
  }

  function snapshotCurrentBestPicks(): Record<string, string> {
    const snapshot: Record<string, string> = {};
    for (const key of bestQuestionKeys) {
      const id = bestPicksRef.current[key];
      if (id) snapshot[key] = id;
    }
    return snapshot;
  }

  async function submitBestPicks() {
    setBestError(null);
    if (!bestPicksComplete) {
      setBestError(
        bestQuestionKeys.length > 1
          ? "Pick one favorite for each topic before submitting."
          : "Pick your favorite candidate before submitting.",
      );
      return;
    }
    setBestPending(true);
    try {
      for (const key of bestQuestionKeys) {
        const candidateId = bestPicksRef.current[key];
        if (!candidateId) {
          setBestError("Pick your favorite candidate before submitting.");
          return;
        }
        const result = await saveBestPickForQuestion(key, candidateId);
        if (result?.error) {
          setBestError(result.error);
          return;
        }
      }
      const snapshot = snapshotCurrentBestPicks();
      setSubmittedBestPicks(snapshot);
      setBestPicksSubmitted(true);
      setConfirmBestOpen(false);
      if (voteMutability === "locked_on_submit") {
        setBestPicksEditing(false);
      }
      void broadcastContestResync(contestId);
      router.refresh();
    } finally {
      setBestPending(false);
    }
  }

  function cancelBestPickEdits() {
    if (!submittedBestPicks) return;
    const restored = { ...submittedBestPicks };
    setBestPicks(restored);
    bestPicksRef.current = restored;
    setBestError(null);
  }

  function handleBestPick(candidate: CandidatesListItem) {
    if (!canEditBest) return;
    const inPool =
      candidate.status === "in_voting" ||
      (votingOpenLive && candidate.status === "visible");
    if (!inPool) return;
    if (excludedSet.has(candidate.id)) return;
    const key = questionKeyForCandidate(candidate);
    setBestPicks((prev) => {
      const next = { ...prev };
      if (next[key] === candidate.id) {
        delete next[key];
      } else {
        next[key] = candidate.id;
      }
      bestPicksRef.current = next;
      return next;
    });
    setBestError(null);
  }

  function handleRankChip(candidate: CandidatesListItem, rankIndex: number) {
    if (!canEditRanks) return;
    const inPool =
      candidate.status === "in_voting" ||
      (votingOpenLive && candidate.status === "visible");
    if (!inPool) return;
    if (excludedSet.has(candidate.id)) return;
    const key = questionKeyForCandidate(candidate);
    setRankPicks((prev) => {
      const slots = Array.from(
        { length: rankSlotCount },
        (_, index) => prev[key]?.[index] ?? "",
      );
      if (slots[rankIndex] === candidate.id) {
        slots[rankIndex] = "";
      } else {
        for (let i = 0; i < slots.length; i += 1) {
          if (slots[i] === candidate.id) slots[i] = "";
        }
        slots[rankIndex] = candidate.id;
      }
      const next = { ...prev, [key]: slots };
      rankPicksRef.current = next;
      return next;
    });
    setRankError(null);
  }

  async function saveRankingsForQuestion(questionKey: string, rankings: string[]) {
    const fd = new FormData();
    fd.set("contestId", contestId);
    fd.set("joinCode", joinCode);
    fd.set("rankings", JSON.stringify(rankings));
    fd.set("inline", "1");
    if (questionKey) fd.set("questionId", questionKey);
    return castBallotAction(null, fd);
  }

  function snapshotCurrentRankPicks(): Record<string, string[]> {
    const snapshot: Record<string, string[]> = {};
    for (const key of rankQuestionKeys) {
      snapshot[key] = Array.from(
        { length: rankSlotCount },
        (_, index) => rankPicksRef.current[key]?.[index] ?? "",
      );
    }
    return snapshot;
  }

  async function submitRankPicks() {
    setRankError(null);
    if (!rankPicksComplete) {
      setRankError(
        `Pick your top ${rankSlotCount} before submitting — tap #1 through #${rankSlotCount} on candidates.`,
      );
      return;
    }
    setRankPending(true);
    try {
      for (const key of rankQuestionKeys) {
        const rankings = Array.from(
          { length: rankSlotCount },
          (_, index) => rankPicksRef.current[key]?.[index] ?? "",
        );
        if (rankings.some((id) => !id)) {
          setRankError(
            `Pick your top ${rankSlotCount} before submitting — tap #1 through #${rankSlotCount} on candidates.`,
          );
          return;
        }
        const result = await saveRankingsForQuestion(key, rankings);
        if (result?.error) {
          setRankError(result.error);
          return;
        }
      }
      const snapshot = snapshotCurrentRankPicks();
      setSubmittedRankPicks(snapshot);
      setRankPicksSubmitted(true);
      setConfirmRankOpen(false);
      if (voteMutability === "locked_on_submit") {
        setRankPicksEditing(false);
      }
      void broadcastContestResync(contestId);
      router.refresh();
    } finally {
      setRankPending(false);
    }
  }

  function cancelRankPickEdits() {
    if (!submittedRankPicks) return;
    const restored = Object.fromEntries(
      Object.entries(submittedRankPicks).map(([k, v]) => [k, [...v]]),
    );
    setRankPicks(restored);
    rankPicksRef.current = restored;
    setRankError(null);
  }

  function hostRevealBadgeLabel(candidate: CandidatesListItem): {
    label: string;
    variant: "default" | "secondary" | "outline";
  } | null {
    // Once voting starts, reveal badges give way to stars / ranks / trophies.
    if (
      votingOpenLive ||
      statusLive === "voting" ||
      statusLive === "finished"
    ) {
      return null;
    }
    if (candidate.status === "pending") {
      return { label: "pending", variant: "outline" };
    }
    if (candidate.status === "visible" || candidate.status === "in_voting") {
      if (justRevealedId && candidate.id === justRevealedId) {
        return { label: "just revealed", variant: "default" };
      }
      return { label: "revealed", variant: "secondary" };
    }
    return { label: candidate.status, variant: "outline" };
  }

  const isCuratedBirthday = isCuratedBirthdayContest(nominationKind, candidateSource);
  // Birthday forms stay on this list (no Nominate tab). Standard nominate UI only
  // when the parent opts in via canShowNominateForm (hidden when Nominate tab exists).
  const birthdayEligible = canNominateEligible || canShowNominateForm;

  const birthdayForm =
    nominationKind === "birthday" &&
    !isCuratedBirthday &&
    birthdayEligible &&
    (nominationsOpenLive || birthdayAlreadySubmitted) ? (
      <BirthdayNominateForm
        key={`birthday-${nominationsOpenLive}-${nominationsReopenedAtLive ?? "n"}`}
        contestId={contestId}
        joinCode={joinCode}
        chartCountry={chartCountry}
        nominationsOpen={nominationsOpenLive}
        alreadySubmitted={birthdayAlreadySubmitted}
        hadChartMatch={birthdayHadChartMatch}
        initialBirthday={initialBirthday}
        initialShowBirthday={initialShowBirthday}
        dateOffset={birthdayDateOffset}
      />
    ) : null;

  const curatedBirthdayForm =
    isCuratedBirthday && isHost ? (
      <CuratedBirthdayForm
        key={`curated-bd-${nominationsOpenLive}-${nominationsReopenedAtLive ?? "n"}`}
        contestId={contestId}
        joinCode={joinCode}
        chartCountry={chartCountry}
        nominationsOpen={nominationsOpenLive}
        remainingEntries={remainingCuratedEntries}
        initialEntries={curatedBirthdayEntries}
        dateOffsetLabel={formatBirthdayOffsetLabel(birthdayDateOffset)}
      />
    ) : null;

  const nominateForm =
    canShowNominateForm &&
    nominationsOpenLive &&
    nominationKind !== "birthday" ? (
      <NominateCandidateForm
        key={`nominate-${nominationsOpenLive}-${nominationsReopenedAtLive ?? "n"}`}
        contestId={contestId}
        joinCode={joinCode}
        remainingNominations={remainingNominations}
        nextNominationNumber={nextNominationNumber}
        theme={theme}
        mode={nominateMode}
        candidateTitleLabel={candidateTitleLabel}
      />
    ) : null;

  function renderCandidateRow(candidate: CandidatesListItem) {
    const isMine = candidate.nominator_user_id === currentUserId;
    const nominatorName = candidate.nominator_user_id
      ? memberNameByUserId[candidate.nominator_user_id] ?? null
      : null;
    const linkedNames = linkedNominatorNamesByCandidateId[candidate.id];
    const hostCuratedLabels = hostCuratedLabelsByCandidateId[candidate.id];
    const photoNumber = photoNumbers[candidate.id];
    const displayTitle =
      theme === "photo" && photoNumber != null
        ? formatPhotoLabel(photoNumber, candidate.title)
        : candidate.title;
    const hostBadge =
      needsAdminReveal && isHost ? hostRevealBadgeLabel(candidate) : null;
    const inVotePool =
      candidate.status === "in_voting" ||
      (votingOpenLive && candidate.status === "visible");
    const canPickThis =
      bestOnlyEnabled && inVotePool && !excludedSet.has(candidate.id);
    const canRankThis =
      rankChipsEnabled && inVotePool && !excludedSet.has(candidate.id);
    const isBestPick = selectedBestIds.has(candidate.id);
    const assignedRank = candidateRankById.get(candidate.id) ?? null;
    return (
      <li
        key={candidate.id}
        className={cn(
          "rounded-lg border px-3 py-2",
          isBestPick || assignedRank
            ? "border-primary bg-primary/10"
            : hostBadge?.label === "just revealed"
              ? "border-primary/40 bg-primary/5"
              : isMine && nominationKind !== "birthday"
                ? "border-muted-foreground/20 bg-muted"
                : "",
          canPickThis && canEditBest
            ? "cursor-pointer transition-colors hover:border-primary/50"
            : "",
        )}
        onClick={
          canPickThis && canEditBest
            ? (event) => {
                const target = event.target as HTMLElement;
                if (target.closest("a, button, input, textarea, select")) {
                  return;
                }
                handleBestPick(candidate);
              }
            : undefined
        }
        onKeyDown={
          canPickThis && canEditBest
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handleBestPick(candidate);
                }
              }
            : undefined
        }
        role={canPickThis && canEditBest ? "button" : undefined}
        tabIndex={canPickThis && canEditBest ? 0 : undefined}
        aria-pressed={canPickThis ? (isBestPick ? true : false) : undefined}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              {theme === "photo" && candidate.url ? (
                <PhotoCandidateImage
                  src={candidate.url}
                  alt={displayTitle}
                  layout="inline"
                />
              ) : null}
              {theme !== "song" && theme !== "photo" && candidate.url ? (
                <CandidateUrlPreview
                  url={candidate.url}
                  alt={displayTitle}
                  layout="inline"
                />
              ) : null}
              <p className="min-w-0 truncate font-medium">{displayTitle}</p>
              {theme === "song" &&
              candidate.spotify_url &&
              (isHost || songLinks === "spotify") ? (
                <SpotifyTrackLink
                  href={candidate.spotify_url}
                  uri={candidate.spotify_uri}
                  openedKey={`${contestId}:${candidate.id}`}
                />
              ) : null}
            </div>
            {candidate.artist ? (
              <p className="text-sm text-muted-foreground">{candidate.artist}</p>
            ) : null}
            {(() => {
              if (nominationKind === "birthday") return null;
              if (!showNominees) return null;
              const curatedByHost = !isParticipantNomination(
                {
                  nominator_user_id: candidate.nominator_user_id,
                  meta: candidate.nomination_origin
                    ? { nomination_origin: candidate.nomination_origin }
                    : null,
                },
                candidateSource,
                hostUserId,
              );
              if (
                curatedByHost &&
                (candidateSource === "curated" ||
                  candidateSource === "combined" ||
                  candidate.nomination_origin === "curated")
              ) {
                return (
                  <p className="text-xs font-medium text-destructive">
                    Curated
                  </p>
                );
              }
              if (isMine) {
                return (
                  <p className="text-xs text-muted-foreground">
                    Your nomination
                    {candidate.status === "pending" ? " · pending reveal" : ""}
                  </p>
                );
              }
              return (
                <p className="text-xs text-muted-foreground">
                  Nominated by {nominatorName ?? "unknown"}
                </p>
              );
            })()}
            {isHost &&
            nominationKind === "birthday" &&
            isCuratedBirthday &&
            hostCuratedLabels &&
            hostCuratedLabels.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                For: {hostCuratedLabels.join(", ")}
              </p>
            ) : null}
            {isHost &&
            nominationKind === "birthday" &&
            !isCuratedBirthday &&
            revealBirthdayIdentities ? (
              <p className="text-xs text-muted-foreground">
                {linkedNames && linkedNames.length > 0
                  ? `Birthday of ${linkedNames.join(", ")}`
                  : `Nominated by ${nominatorName ?? "unknown"}${
                      isMine ? " (you)" : ""
                    }`}
              </p>
            ) : null}
          </div>
          {starRatingEnabled &&
          inVotePool &&
          !excludedSet.has(candidate.id) ? (
            <StarRatingInput
              value={ratings[candidate.id] ?? 0}
              onChange={(next) => handleStarChange(candidate, next)}
              readOnly={!canEditStars}
            />
          ) : canRankThis ? (
            <div className="flex shrink-0 items-center gap-1">
              {Array.from({ length: rankSlotCount }, (_, index) => {
                const selected = assignedRank === index + 1;
                return (
                  <button
                    key={index}
                    type="button"
                    disabled={!canEditRanks}
                    aria-pressed={selected}
                    aria-label={`Rank #${index + 1}`}
                    className={cn(
                      "inline-flex size-8 items-center justify-center rounded-md border text-xs font-semibold tabular-nums transition-colors",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
                      !canEditRanks && "opacity-70",
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleRankChip(candidate, index);
                    }}
                  >
                    #{index + 1}
                  </button>
                );
              })}
            </div>
          ) : canPickThis ? (
            <span
              className={cn(
                "inline-flex size-9 shrink-0 items-center justify-center rounded-full",
                isBestPick
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
              aria-hidden
            >
              <TrophyIcon
                className="size-5"
                weight={isBestPick ? "fill" : "regular"}
              />
            </span>
          ) : hostBadge ? (
            <Badge variant={hostBadge.variant}>{hostBadge.label}</Badge>
          ) : null}
        </div>
        {theme === "song" && songLinks !== "none" && candidate.url ? (
          <SongPreviewPlayer
            key={`${candidate.id}:${candidate.url}`}
            previewUrl={candidate.url}
          />
        ) : null}
        {theme === "photo" && !candidate.url ? (
          <p className="text-xs text-muted-foreground">
            {candidate.photo_cleared
              ? "Photo removed after the presentation finished."
              : "No photo available."}
          </p>
        ) : null}
        {theme !== "song" &&
        theme !== "photo" &&
        candidate.url &&
        !isContestImageUrl(candidate.url) ? (
          <CandidateUrlPreview url={candidate.url} alt={displayTitle} />
        ) : null}
        {theme !== "song" && theme !== "photo" && candidate.description ? (
          <p className="text-xs text-muted-foreground">{candidate.description}</p>
        ) : null}
        {nominationKind !== "birthday" && isMine && nominationsOpenLive ? (
          <EditCandidateControls
            joinCode={joinCode}
            contestId={contestId}
            theme={theme}
            candidate={{
              id: candidate.id,
              title: candidate.title,
              artist: candidate.artist,
              url: candidate.url,
              description: candidate.description,
              deletePhotoOnFinish: candidate.delete_photo_on_finish === true,
            }}
          />
        ) : null}
      </li>
    );
  }

  return (
    <div className="space-y-4">
      {curatedBirthdayForm}
      {birthdayForm}
      {nominationKind === "birthday" &&
      !isCuratedBirthday &&
      !isHost &&
      visibleCandidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Chart songs stay hidden until the host reveals candidates for voting.
        </p>
      ) : null}
      {visibleCandidates.length === 0 ? (
        nominationKind === "birthday" && !isHost && !isCuratedBirthday ? null : (needsAdminReveal ||
          deferredCandidateReveal) &&
          !isHost ? (
          <p className="text-sm text-muted-foreground">
            {deferredCandidateReveal && !needsAdminReveal
              ? "Candidates will appear here when they become visible."
              : "Candidates will appear here as the host reveals them."}
          </p>
        ) : isCuratedBirthday ? (
          <p className="text-sm text-muted-foreground">
            {isHost
              ? "Add people above, then release candidates to look up chart hits."
              : "Songs will appear here when the host releases candidates."}
          </p>
        ) : nominationKind === "birthday" ? (
          <p className="text-sm text-muted-foreground">No birthday hits yet.</p>
        ) : null
      ) : (
        <div className="space-y-4">
          {revealedCandidates.length > 0 ? (
            <ul className="space-y-2">
              {revealedCandidates.map((candidate) =>
                renderCandidateRow(candidate),
              )}
            </ul>
          ) : ownPendingCandidates.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              Candidates will appear here as the host reveals them.
            </p>
          ) : null}

          {ownPendingCandidates.length > 0 ? (
            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-sm font-semibold text-muted-foreground">
                Your nominations
              </p>
              <ul className="space-y-2">
                {ownPendingCandidates.map((candidate) =>
                  renderCandidateRow(candidate),
                )}
              </ul>
            </div>
          ) : null}
        </div>
      )}
      {starRatingEnabled && starVotingOpen ? (
        <div className="space-y-2">
          {starLocked ? (
            <p className="text-xs text-muted-foreground">
              Votes are locked after submit for this contest.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Tap stars to rate, then submit. Tap a star again to clear it.
              {voteMutability === "editable_until_close"
                ? " After submit, you can still change your rating by tapping a candidate's stars again, then re-submit."
                : null}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {starLocked || (ratingsSubmitted && !ratingsDirty) ? (
              <Button
                type="button"
                variant="secondary"
                disabled
                className="disabled:opacity-100"
              >
                <CheckIcon className="size-4" weight="bold" />
                Submitted
              </Button>
            ) : canEditStars ? (
              <>
                <Button
                  type="button"
                  disabled={ratingPending}
                  onClick={() => {
                    if (
                      voteMutability === "locked_on_submit" &&
                      !ratingsSubmitted
                    ) {
                      setConfirmRatingsOpen(true);
                      return;
                    }
                    void submitStarRatings();
                  }}
                >
                  {ratingPending
                    ? "Saving…"
                    : ratingsSubmitted
                      ? "Re-submit ratings"
                      : "Submit ratings"}
                </Button>
                {ratingsSubmitted && ratingsDirty ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={ratingPending}
                    onClick={cancelRatingEdits}
                  >
                    Cancel
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {bestOnlyEnabled && bestVotingOpen ? (
        <div className="space-y-2">
          {bestLocked ? (
            <p className="text-xs text-muted-foreground">
              Votes are locked after submit for this contest.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Tap your favorite to mark it with a trophy, then submit. Tap again
              to clear.
              {voteMutability === "editable_until_close"
                ? " After submit, you can still change your pick by tapping a candidate again, then re-submit."
                : null}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {bestLocked || (bestPicksSubmitted && !bestPicksDirty) ? (
              <Button
                type="button"
                variant="secondary"
                disabled
                className="disabled:opacity-100"
              >
                <CheckIcon className="size-4" weight="bold" />
                Submitted
              </Button>
            ) : canEditBest ? (
              <>
                <Button
                  type="button"
                  disabled={bestPending || !bestPicksComplete}
                  onClick={() => {
                    if (
                      voteMutability === "locked_on_submit" &&
                      !bestPicksSubmitted
                    ) {
                      setConfirmBestOpen(true);
                      return;
                    }
                    void submitBestPicks();
                  }}
                >
                  {bestPending
                    ? "Saving…"
                    : bestPicksSubmitted
                      ? "Re-submit pick"
                      : "Submit pick"}
                </Button>
                {bestPicksSubmitted && bestPicksDirty ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={bestPending}
                    onClick={cancelBestPickEdits}
                  >
                    Cancel
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {rankChipsEnabled && rankVotingOpen ? (
        <div className="space-y-2">
          {rankLocked ? (
            <p className="text-xs text-muted-foreground">
              Votes are locked after submit for this contest.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Tap #1–#{rankSlotCount} on candidates to set your ranking, then
              submit.
              {voteMutability === "editable_until_close"
                ? " After submit, you can still change ranks and re-submit."
                : null}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {rankLocked || (rankPicksSubmitted && !rankPicksDirty) ? (
              <Button
                type="button"
                variant="secondary"
                disabled
                className="disabled:opacity-100"
              >
                <CheckIcon className="size-4" weight="bold" />
                Submitted
              </Button>
            ) : canEditRanks ? (
              <>
                <Button
                  type="button"
                  disabled={rankPending || !rankPicksComplete}
                  onClick={() => {
                    if (
                      voteMutability === "locked_on_submit" &&
                      !rankPicksSubmitted
                    ) {
                      setConfirmRankOpen(true);
                      return;
                    }
                    void submitRankPicks();
                  }}
                >
                  {rankPending
                    ? "Saving…"
                    : rankPicksSubmitted
                      ? "Update ballot"
                      : "Submit ballot"}
                </Button>
                {rankPicksSubmitted && rankPicksDirty ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={rankPending}
                    onClick={cancelRankPickEdits}
                  >
                    Cancel
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {ratingError ? (
        <p className="text-sm text-destructive" role="alert">
          {ratingError}
        </p>
      ) : null}
      {bestError ? (
        <p className="text-sm text-destructive" role="alert">
          {bestError}
        </p>
      ) : null}
      {rankError ? (
        <p className="text-sm text-destructive" role="alert">
          {rankError}
        </p>
      ) : null}
      {nominateForm}
      <Dialog open={confirmRatingsOpen} onOpenChange={setConfirmRatingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Submit ratings permanently?</DialogTitle>
            <DialogDescription>
              Vote changes are locked on submit for this contest. Once you
              confirm, you cannot change your stars.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={ratingPending}
              onClick={() => setConfirmRatingsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={ratingPending}
              onClick={() => submitStarRatings()}
            >
              {ratingPending ? "Saving…" : "Confirm & submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmBestOpen} onOpenChange={setConfirmBestOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Submit pick permanently?</DialogTitle>
            <DialogDescription>
              Vote changes are locked on submit for this contest. Once you
              confirm, you cannot change your favorite.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={bestPending}
              onClick={() => setConfirmBestOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={bestPending || !bestPicksComplete}
              onClick={() => submitBestPicks()}
            >
              {bestPending ? "Saving…" : "Confirm & submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmRankOpen} onOpenChange={setConfirmRankOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Submit ballot permanently?</DialogTitle>
            <DialogDescription>
              Vote changes are locked on submit for this contest. Once you
              confirm, you cannot change your ranking.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={rankPending}
              onClick={() => setConfirmRankOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={rankPending || !rankPicksComplete}
              onClick={() => submitRankPicks()}
            >
              {rankPending ? "Saving…" : "Confirm & submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {isHost && removedCandidates.length > 0 ? (
        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-sm font-semibold text-muted-foreground">
            Removed Candidates{" "}
            <span className="font-normal">({removedCandidates.length})</span>
          </p>
          <ul className="space-y-2">
            {removedCandidates.map((candidate) => (
              <li
                key={candidate.id}
                className="rounded-lg border border-dashed px-3 py-2 text-muted-foreground"
              >
                <p className="min-w-0 break-words font-medium">
                  {candidate.title}
                  {candidate.artist ? (
                    <span className="font-normal"> · {candidate.artist}</span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs">
                  Nominated by {candidate.nominatorDisplayName}
                  {candidate.removedAt
                    ? ` · removed ${new Date(candidate.removedAt).toLocaleString()}`
                    : null}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
