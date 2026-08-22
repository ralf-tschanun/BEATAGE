"use client";

import { useEffect, useMemo, useState } from "react";
import {
  applyCandidateLivePatch,
  subscribeContestCandidates,
  subscribeContestMeta,
  type ContestLiveMeta,
  type LiveCandidateRow,
} from "@/components/contest-live-refresh";
import { ContestPhaseStatusBadge } from "@/components/contest-phase-status-badge";
import {
  deriveContestPhaseLabel,
  phaseRevealCountsFromCandidates,
} from "@/lib/contest-phase";

export { deriveContestPhaseLabel } from "@/lib/contest-phase";

type ContestStatusBadgesProps = {
  contestId: string;
  initialStatus: string;
  initialNominationsOpen: boolean;
  initialVotingOpen: boolean;
  initialResultsPhase: string | null;
  initialResultsReveal?: string | null;
  initialResultsRevealStep?: number;
  initialNominatorRevealStep?: number;
  candidateSource?: string | null;
  nominationDurationSeconds?: number | null;
  candidateReveal?: string | null;
  initialNominationDeadline?: string | null;
  initialVotingClosesAt?: string | null;
  /** Seed for live reveal progress (admin reveal modes). */
  initialCandidates?: Array<{ id: string; status: string }>;
};

export function ContestStatusBadges({
  contestId,
  initialStatus,
  initialNominationsOpen,
  initialVotingOpen,
  initialResultsPhase,
  initialResultsReveal = null,
  initialResultsRevealStep = 0,
  initialNominatorRevealStep = 0,
  candidateSource = null,
  nominationDurationSeconds = null,
  candidateReveal = null,
  initialNominationDeadline = null,
  initialVotingClosesAt = null,
  initialCandidates = [],
}: ContestStatusBadgesProps) {
  const [meta, setMeta] = useState({
    status: initialStatus,
    nominationsOpen: initialNominationsOpen,
    votingOpen: initialVotingOpen,
    resultsPhase: initialResultsPhase,
    resultsReveal: initialResultsReveal,
    resultsRevealStep: initialResultsRevealStep,
    nominatorRevealStep: initialNominatorRevealStep,
    candidateSource,
    nominationDurationSeconds,
    candidateReveal,
    nominationDeadline: initialNominationDeadline,
    votingClosesAt: initialVotingClosesAt,
  });
  const [candidateRows, setCandidateRows] = useState(initialCandidates);

  useEffect(() => {
    setMeta({
      status: initialStatus,
      nominationsOpen: initialNominationsOpen,
      votingOpen: initialVotingOpen,
      resultsPhase: initialResultsPhase,
      resultsReveal: initialResultsReveal,
      resultsRevealStep: initialResultsRevealStep,
      nominatorRevealStep: initialNominatorRevealStep,
      candidateSource,
      nominationDurationSeconds,
      candidateReveal,
      nominationDeadline: initialNominationDeadline,
      votingClosesAt: initialVotingClosesAt,
    });
  }, [
    initialStatus,
    initialNominationsOpen,
    initialVotingOpen,
    initialResultsPhase,
    initialResultsReveal,
    initialResultsRevealStep,
    initialNominatorRevealStep,
    candidateSource,
    nominationDurationSeconds,
    candidateReveal,
    initialNominationDeadline,
    initialVotingClosesAt,
  ]);

  useEffect(() => {
    setCandidateRows(initialCandidates);
  }, [initialCandidates]);

  useEffect(() => {
    return subscribeContestMeta(contestId, (next: ContestLiveMeta) => {
      setMeta((prev) => ({
        ...prev,
        status: next.status,
        nominationsOpen: next.nominationsOpen,
        votingOpen: next.votingOpen,
        resultsPhase: next.resultsPhase,
        resultsReveal: next.resultsReveal,
        resultsRevealStep: next.resultsRevealStep,
        nominatorRevealStep: next.nominatorRevealStep,
        nominationDeadline: next.nominationDeadline,
        votingClosesAt: next.votingClosesAt,
      }));
    });
  }, [contestId]);

  useEffect(() => {
    return subscribeContestCandidates(contestId, (patch) => {
      setCandidateRows((prev) => {
        const next = applyCandidateLivePatch(
          prev,
          patch,
          (row: LiveCandidateRow) => ({
            id: row.id,
            status: row.status,
          }),
        );
        return next ?? prev;
      });
    });
  }, [contestId]);

  const phase = useMemo(
    () => ({
      ...meta,
      ...phaseRevealCountsFromCandidates(candidateRows),
    }),
    [meta, candidateRows],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ContestPhaseStatusBadge
        contestId={contestId}
        phase={phase}
        nominationDeadline={meta.nominationDeadline}
        votingClosesAt={meta.votingClosesAt}
      />
    </div>
  );
}
