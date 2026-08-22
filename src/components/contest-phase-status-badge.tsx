"use client";

import { useEffect, useMemo, useState } from "react";
import {
  subscribeContestMeta,
  type ContestLiveMeta,
} from "@/components/contest-live-refresh";
import { VotingCountdown } from "@/components/voting-countdown";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CONTEST_PHASE_BADGE_CLASS,
  contestPhaseBadgeVariant,
  deriveContestPhaseDisplay,
  type ContestPhaseInput,
} from "@/lib/contest-phase";

const COUNTDOWN_BADGE_CLASS =
  "border-amber-200/80 bg-amber-100 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/80 dark:text-amber-300";

type ContestPhaseStatusBadgeProps = {
  contestId?: string;
  phase: ContestPhaseInput;
  nominationDeadline?: string | null;
  votingClosesAt?: string | null;
  className?: string;
  title?: string;
};

export function ContestPhaseStatusBadge({
  contestId,
  phase,
  nominationDeadline = null,
  votingClosesAt = null,
  className,
  title,
}: ContestPhaseStatusBadgeProps) {
  const [nominationDeadlineLive, setNominationDeadlineLive] = useState(
    nominationDeadline,
  );
  const [votingClosesAtLive, setVotingClosesAtLive] = useState(votingClosesAt);
  const [nominationsOpen, setNominationsOpen] = useState(phase.nominationsOpen);
  const [votingOpen, setVotingOpen] = useState(phase.votingOpen);
  const [status, setStatus] = useState(phase.status);

  useEffect(() => {
    setNominationDeadlineLive(nominationDeadline);
    setVotingClosesAtLive(votingClosesAt);
    setNominationsOpen(phase.nominationsOpen);
    setVotingOpen(phase.votingOpen);
    setStatus(phase.status);
  }, [
    nominationDeadline,
    votingClosesAt,
    phase.nominationsOpen,
    phase.votingOpen,
    phase.status,
  ]);

  useEffect(() => {
    if (!contestId) return;
    return subscribeContestMeta(contestId, (meta: ContestLiveMeta) => {
      setNominationDeadlineLive(meta.nominationDeadline);
      setVotingClosesAtLive(meta.votingClosesAt);
      setNominationsOpen(meta.nominationsOpen);
      setVotingOpen(meta.votingOpen);
      setStatus(meta.status);
    });
  }, [contestId]);

  const display = useMemo(
    () =>
      deriveContestPhaseDisplay({
        ...phase,
        status,
        nominationsOpen,
        votingOpen,
        nominationDeadline: nominationDeadlineLive,
        votingClosesAt: votingClosesAtLive,
      }),
    [
      phase,
      status,
      nominationsOpen,
      votingOpen,
      nominationDeadlineLive,
      votingClosesAtLive,
    ],
  );

  if (display.kind === "countdown") {
    return (
      <Badge
        variant="outline"
        className={cn(
          "w-fit max-w-full shrink whitespace-nowrap text-xs font-medium",
          COUNTDOWN_BADGE_CLASS,
          className,
        )}
        title={title}
      >
        <VotingCountdown
          closesAt={display.closesAt}
          prefix={display.prefix}
          expiredLabel={display.expiredLabel}
          inline
          className="text-xs font-medium text-inherit"
        />
      </Badge>
    );
  }

  return (
    <Badge
      variant={contestPhaseBadgeVariant(display.tone)}
      className={cn(
        "w-fit max-w-full shrink truncate text-xs font-medium",
        CONTEST_PHASE_BADGE_CLASS[display.tone],
        className,
      )}
      title={title ?? display.label}
    >
      {display.label}
    </Badge>
  );
}
