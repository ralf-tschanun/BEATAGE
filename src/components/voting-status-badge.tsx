"use client";

import { VotingCountdown } from "@/components/voting-countdown";

export type VotingStatusKind = "open" | "reopened" | "closed" | "closing";

export function resolveVotingStatus(input: {
  votingOpen: boolean;
  votingClosesAt?: string | null;
  votingReopenedAt?: string | null;
  nowMs?: number;
}): VotingStatusKind {
  const now = input.nowMs ?? Date.now();
  if (!input.votingOpen) return "closed";
  if (input.votingClosesAt) {
    const closesAt = Date.parse(input.votingClosesAt);
    if (Number.isFinite(closesAt) && closesAt > now) {
      return "closing";
    }
  }
  if (input.votingReopenedAt) return "reopened";
  return "open";
}

type VotingStatusBadgeProps = {
  votingOpen: boolean;
  votingClosesAt?: string | null;
  votingReopenedAt?: string | null;
};

export function VotingStatusBadge({
  votingOpen,
  votingClosesAt = null,
  votingReopenedAt = null,
}: VotingStatusBadgeProps) {
  const kind = resolveVotingStatus({
    votingOpen,
    votingClosesAt,
    votingReopenedAt,
  });

  if (kind === "closing" && votingClosesAt) {
    return (
      <VotingCountdown
        closesAt={votingClosesAt}
        className="text-sm font-medium text-amber-700 dark:text-amber-400"
        prefix="Voting: closing in"
        expiredLabel="Voting: closed"
      />
    );
  }

  if (kind === "closed") {
    return (
      <p className="text-sm font-medium text-destructive">Voting: closed</p>
    );
  }

  if (kind === "reopened") {
    return (
      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
        Voting: re-opened
      </p>
    );
  }

  return (
    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
      Voting: open
    </p>
  );
}
