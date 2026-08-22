"use client";

import { useEffect, useState } from "react";
import {
  subscribeContestMeta,
  type ContestLiveMeta,
} from "@/components/contest-live-refresh";
import { VotingCountdown } from "@/components/voting-countdown";
import { isNominationsNotStartedYet } from "@/lib/contest-phase";

export type NominationStatusKind =
  | "open"
  | "reopened"
  | "closed"
  | "closing"
  | "not_started";

export function resolveNominationStatus(input: {
  nominationsOpen: boolean;
  nominationDeadline?: string | null;
  nominationsReopenedAt?: string | null;
  nominationDurationSeconds?: number | null;
  nowMs?: number;
}): NominationStatusKind {
  const now = input.nowMs ?? Date.now();
  if (
    isNominationsNotStartedYet({
      nominationsOpen: input.nominationsOpen,
      nominationDurationSeconds: input.nominationDurationSeconds,
      nominationDeadline: input.nominationDeadline,
    })
  ) {
    return "not_started";
  }
  if (!input.nominationsOpen) return "closed";
  if (input.nominationDeadline) {
    const closesAt = Date.parse(input.nominationDeadline);
    if (Number.isFinite(closesAt) && closesAt > now) {
      return "closing";
    }
  }
  if (input.nominationsReopenedAt) return "reopened";
  return "open";
}

type NominationStatusBadgeProps = {
  nominationsOpen: boolean;
  nominationDeadline?: string | null;
  nominationsReopenedAt?: string | null;
  nominationDurationSeconds?: number | null;
};

export function NominationStatusBadge({
  nominationsOpen,
  nominationDeadline = null,
  nominationsReopenedAt = null,
  nominationDurationSeconds = null,
}: NominationStatusBadgeProps) {
  const kind = resolveNominationStatus({
    nominationsOpen,
    nominationDeadline,
    nominationsReopenedAt,
    nominationDurationSeconds,
  });

  if (kind === "closing" && nominationDeadline) {
    return (
      <VotingCountdown
        closesAt={nominationDeadline}
        className="text-sm font-medium text-amber-700 dark:text-amber-400"
        prefix="Nominations: closing in"
        expiredLabel="Nominations: closed"
      />
    );
  }

  if (kind === "not_started") {
    return (
      <p className="text-sm font-medium text-muted-foreground">
        Nominations: not started yet
      </p>
    );
  }

  if (kind === "closed") {
    return (
      <p className="text-sm font-medium text-destructive">Nominations: closed</p>
    );
  }

  if (kind === "reopened") {
    return (
      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
        Nominations: re-opened
      </p>
    );
  }

  return (
    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
      Nominations: open
    </p>
  );
}

type ColoredNominationStatusProps = {
  open: boolean;
  openLabel?: string;
  closedLabel?: string;
  notStartedLabel?: string;
  nominationDeadline?: string | null;
  nominationDurationSeconds?: number | null;
  /** Smaller text for use beside a card title. */
  compact?: boolean;
};

/** Inline status for card descriptions (open = green, closed = red, closing = amber countdown). */
export function ColoredNominationStatus({
  open,
  openLabel = "Nominations open",
  closedLabel = "Nominations closed",
  notStartedLabel = "Nomination not started yet",
  nominationDeadline = null,
  nominationDurationSeconds = null,
  compact = false,
}: ColoredNominationStatusProps) {
  const kind = resolveNominationStatus({
    nominationsOpen: open,
    nominationDeadline,
    nominationDurationSeconds,
  });
  const sizeClass = compact ? "text-xs font-medium" : "font-medium";

  if (kind === "closing" && nominationDeadline) {
    return (
      <VotingCountdown
        closesAt={nominationDeadline}
        className={`${sizeClass} text-amber-700 dark:text-amber-400`}
        prefix={compact ? "closing in" : "Nominations: closing in"}
        expiredLabel={closedLabel}
        inline
      />
    );
  }

  if (kind === "not_started") {
    return (
      <span className={`${sizeClass} text-muted-foreground`}>
        {notStartedLabel}
      </span>
    );
  }

  return (
    <span
      className={
        open
          ? `${sizeClass} text-emerald-700 dark:text-emerald-400`
          : `${sizeClass} text-destructive`
      }
    >
      {open ? openLabel : closedLabel}
    </span>
  );
}

type LiveColoredNominationStatusProps = {
  contestId: string;
  initialOpen: boolean;
  initialNominationDeadline?: string | null;
  initialNominationDurationSeconds?: number | null;
  openLabel?: string;
  closedLabel?: string;
  notStartedLabel?: string;
};

/** Live nomination status (updates when host starts a timed window). */
export function LiveColoredNominationStatus({
  contestId,
  initialOpen,
  initialNominationDeadline = null,
  initialNominationDurationSeconds = null,
  openLabel,
  closedLabel,
  notStartedLabel,
}: LiveColoredNominationStatusProps) {
  const [open, setOpen] = useState(initialOpen);
  const [deadline, setDeadline] = useState(initialNominationDeadline);

  useEffect(() => {
    setOpen(initialOpen);
    setDeadline(initialNominationDeadline);
  }, [initialOpen, initialNominationDeadline]);

  useEffect(() => {
    return subscribeContestMeta(contestId, (meta: ContestLiveMeta) => {
      setOpen(meta.nominationsOpen);
      setDeadline(meta.nominationDeadline);
    });
  }, [contestId]);

  return (
    <ColoredNominationStatus
      open={open}
      nominationDeadline={deadline}
      nominationDurationSeconds={initialNominationDurationSeconds}
      openLabel={openLabel}
      closedLabel={closedLabel}
      notStartedLabel={notStartedLabel}
    />
  );
}
