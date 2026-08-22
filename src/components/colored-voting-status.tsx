"use client";

import { useEffect, useState } from "react";
import {
  subscribeContestMeta,
  type ContestLiveMeta,
} from "@/components/contest-live-refresh";
import { VotingCountdown } from "@/components/voting-countdown";
import { resolveVotingStatus } from "@/components/voting-status-badge";

type ColoredVotingStatusProps = {
  votingOpen: boolean;
  votingClosesAt?: string | null;
  votingReopenedAt?: string | null;
  /**
   * Prefix before the status word (default "Voting").
   * Pass "" for a short title badge ("open" / "closed").
   */
  labelPrefix?: string;
  /** Smaller text for use beside a card title. */
  compact?: boolean;
};

/**
 * Inline colored voting status for card descriptions (open = green, closed = red).
 * Uses span so it can sit next to nomination status under a CollapsibleCard title.
 */
export function ColoredVotingStatus({
  votingOpen,
  votingClosesAt = null,
  votingReopenedAt = null,
  labelPrefix = "Voting",
  compact = false,
}: ColoredVotingStatusProps) {
  const kind = resolveVotingStatus({
    votingOpen,
    votingClosesAt,
    votingReopenedAt,
  });
  const sizeClass = compact ? "text-xs font-medium" : "font-medium";
  const word = (status: string) =>
    labelPrefix ? `${labelPrefix} ${status}` : status;

  if (kind === "closing" && votingClosesAt) {
    return (
      <VotingCountdown
        closesAt={votingClosesAt}
        className={`${sizeClass} text-amber-700 dark:text-amber-400`}
        prefix={labelPrefix ? `${labelPrefix}: closing in` : "closing in"}
        expiredLabel={word("closed")}
        inline
      />
    );
  }

  if (kind === "closed") {
    return (
      <span className={`${sizeClass} text-destructive`}>{word("closed")}</span>
    );
  }

  if (kind === "reopened") {
    return (
      <span
        className={`${sizeClass} text-emerald-700 dark:text-emerald-400`}
      >
        {word("re-opened")}
      </span>
    );
  }

  return (
    <span className={`${sizeClass} text-emerald-700 dark:text-emerald-400`}>
      {word("open")}
    </span>
  );
}

type LiveColoredVotingStatusProps = {
  contestId: string;
  initialVotingOpen: boolean;
  initialVotingClosesAt?: string | null;
  initialVotingReopenedAt?: string | null;
  /** When false, renders nothing (e.g. nominations-only phase). */
  visible?: boolean;
  labelPrefix?: string;
};

/** Live voting status for Candidates card when votes happen on the list (★ / Best). */
export function LiveColoredVotingStatus({
  contestId,
  initialVotingOpen,
  initialVotingClosesAt = null,
  initialVotingReopenedAt = null,
  visible = true,
  labelPrefix = "Voting",
}: LiveColoredVotingStatusProps) {
  const [votingOpen, setVotingOpen] = useState(initialVotingOpen);
  const [votingClosesAt, setVotingClosesAt] = useState(initialVotingClosesAt);
  const [votingReopenedAt, setVotingReopenedAt] = useState(
    initialVotingReopenedAt,
  );

  useEffect(() => {
    setVotingOpen(initialVotingOpen);
    setVotingClosesAt(initialVotingClosesAt);
    setVotingReopenedAt(initialVotingReopenedAt);
  }, [initialVotingOpen, initialVotingClosesAt, initialVotingReopenedAt]);

  useEffect(() => {
    return subscribeContestMeta(contestId, (meta: ContestLiveMeta) => {
      setVotingOpen(meta.votingOpen);
      setVotingClosesAt(meta.votingClosesAt);
      setVotingReopenedAt(meta.votingReopenedAt);
    });
  }, [contestId]);

  if (!visible) return null;

  return (
    <ColoredVotingStatus
      votingOpen={votingOpen}
      votingClosesAt={votingClosesAt}
      votingReopenedAt={votingReopenedAt}
      labelPrefix={labelPrefix}
    />
  );
}
