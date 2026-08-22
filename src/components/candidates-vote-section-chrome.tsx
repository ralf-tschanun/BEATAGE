"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LiveColoredCandidateRevealStatus } from "@/components/candidate-reveal-status";
import { LiveColoredVotingStatus } from "@/components/colored-voting-status";
import { subscribeContestMeta } from "@/components/contest-live-refresh";
import { LiveColoredNominationStatus } from "@/components/nomination-status-badge";

type LiveVoteSectionTitleProps = {
  contestId: string;
  initialVotingOpen: boolean;
  /** Title while voting is closed (e.g. "Candidates"). */
  idleTitle: ReactNode;
};

/** Section heading: "Vote" while voting is open, otherwise idle title. */
export function LiveVoteSectionTitle({
  contestId,
  initialVotingOpen,
  idleTitle,
}: LiveVoteSectionTitleProps) {
  const [votingOpen, setVotingOpen] = useState(initialVotingOpen);

  useEffect(() => {
    setVotingOpen(initialVotingOpen);
  }, [initialVotingOpen]);

  useEffect(() => {
    return subscribeContestMeta(contestId, (meta) => {
      setVotingOpen(meta.votingOpen);
    });
  }, [contestId]);

  return <>{votingOpen ? "Vote" : idleTitle}</>;
}

type LiveStandardCandidatesDescriptionProps = {
  contestId: string;
  initialVotingOpen: boolean;
  initialStatus: string;
  initialNominationsOpen: boolean;
  initialNominationDeadline?: string | null;
  initialNominationDurationSeconds?: number | null;
  initialVotingClosesAt?: string | null;
  initialVotingReopenedAt?: string | null;
  needsAdminReveal: boolean;
  nominationsOpenLabel?: string;
  candidateCountFallback: string;
  initialCandidates: Array<{ id: string; status: string }>;
  /** Extra note when not in the voting-open pipeline (e.g. migration hint). */
  idleSuffix?: ReactNode;
};

/**
 * Candidates card status line.
 * While voting is open: Nomination completed · Candidates revealed · Voting open + vote prompt.
 */
export function LiveStandardCandidatesDescription({
  contestId,
  initialVotingOpen,
  initialStatus,
  initialNominationsOpen,
  initialNominationDeadline = null,
  initialNominationDurationSeconds = null,
  initialVotingClosesAt = null,
  initialVotingReopenedAt = null,
  needsAdminReveal,
  nominationsOpenLabel,
  candidateCountFallback,
  initialCandidates,
  idleSuffix = null,
}: LiveStandardCandidatesDescriptionProps) {
  const [votingOpen, setVotingOpen] = useState(initialVotingOpen);
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    setVotingOpen(initialVotingOpen);
    setStatus(initialStatus);
  }, [initialVotingOpen, initialStatus]);

  useEffect(() => {
    return subscribeContestMeta(contestId, (meta) => {
      setVotingOpen(meta.votingOpen);
      setStatus(meta.status);
    });
  }, [contestId]);

  const showVotingPipeline =
    votingOpen || status === "voting" || status === "finished";

  if (showVotingPipeline) {
    return (
      <span className="flex flex-col gap-1.5">
        <span>
          <LiveColoredNominationStatus
            contestId={contestId}
            initialOpen={false}
            initialNominationDeadline={initialNominationDeadline}
            initialNominationDurationSeconds={initialNominationDurationSeconds}
            closedLabel="Nomination completed"
            notStartedLabel="Nomination not started yet"
          />
          {" · "}
          {needsAdminReveal ? (
            <LiveColoredCandidateRevealStatus
              contestId={contestId}
              needsAdminReveal
              initialStatus={status}
              initialCandidates={initialCandidates}
            />
          ) : (
            <span className="font-medium text-destructive">
              Candidates revealed
            </span>
          )}
          {" · "}
          <LiveColoredVotingStatus
            contestId={contestId}
            initialVotingOpen={votingOpen}
            initialVotingClosesAt={initialVotingClosesAt}
            initialVotingReopenedAt={initialVotingReopenedAt}
          />
        </span>
        {votingOpen ? (
          <span className="text-foreground">
            It&apos;s your turn — vote for your favorite candidate.
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <>
      <LiveColoredNominationStatus
        contestId={contestId}
        initialOpen={initialNominationsOpen}
        initialNominationDeadline={initialNominationDeadline}
        initialNominationDurationSeconds={initialNominationDurationSeconds}
        openLabel={nominationsOpenLabel}
        closedLabel="Nomination completed"
        notStartedLabel="Nomination not started yet"
      />
      {needsAdminReveal ? (
        <LiveColoredCandidateRevealStatus
          contestId={contestId}
          needsAdminReveal
          initialStatus={initialStatus}
          leadingSeparator
          idleFallback={candidateCountFallback}
          initialCandidates={initialCandidates}
        />
      ) : (
        <>{` · ${candidateCountFallback}`}</>
      )}
      {idleSuffix}
    </>
  );
}
