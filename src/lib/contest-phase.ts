import {
  isAdminCandidateReveal,
  isInstantResultsReveal,
  parseCandidateReveal,
} from "@/lib/plans";

export type ContestPhaseTone =
  | "nominations"
  | "voting"
  | "waiting"
  | "revealing"
  | "finished"
  | "expired";

/** Shared phase-badge colors for contest page and dashboard. */
export const CONTEST_PHASE_BADGE_CLASS: Record<ContestPhaseTone, string> = {
  nominations:
    "border-amber-200/80 bg-amber-100 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/80 dark:text-amber-300",
  voting:
    "border-primary/25 bg-primary/10 text-primary dark:border-primary/30 dark:bg-primary/15",
  waiting:
    "border-border bg-muted text-muted-foreground",
  revealing:
    "border-violet-200/80 bg-violet-100 text-violet-900 dark:border-violet-900/50 dark:bg-violet-950/80 dark:text-violet-300",
  finished: "",
  expired: "",
};

export function contestPhaseBadgeVariant(
  tone: ContestPhaseTone,
): "destructive" | "outline" {
  return tone === "finished" || tone === "expired" ? "destructive" : "outline";
}

export type CandidateRevealStatusKind = "idle" | "revealing" | "complete";

export function resolveCandidateRevealStatus(input: {
  needsAdminReveal: boolean;
  pendingCount: number;
  revealedCount: number;
  /** Contest already in voting / finished — reveal phase is over. */
  votingOrLater: boolean;
}): CandidateRevealStatusKind {
  if (!input.needsAdminReveal) return "idle";
  if (input.pendingCount > 0) return "revealing";
  if (input.revealedCount > 0 || input.votingOrLater) return "complete";
  return "idle";
}

export function countCandidateRevealProgress(
  rows: Array<{ status: string }>,
) {
  let pendingCount = 0;
  let revealedCount = 0;
  for (const row of rows) {
    if (row.status === "withdrawn" || row.status === "rejected") continue;
    if (row.status === "pending") pendingCount += 1;
    else if (row.status === "visible" || row.status === "in_voting") {
      revealedCount += 1;
    }
  }
  return {
    pendingCount,
    revealedCount,
    totalCount: pendingCount + revealedCount,
  };
}

export type ContestPhaseInput = {
  status: string;
  nominationsOpen: boolean;
  votingOpen: boolean;
  resultsPhase: string | null;
  resultsReveal?: string | null;
  resultsRevealStep?: number;
  nominatorRevealStep?: number;
  /** Helps distinguish “start nominations” vs “start voting” while status is open. */
  candidateSource?: string | null;
  nominationDurationSeconds?: number | null;
  /** Host reveal mode (admin_batch / admin_sequential / …). */
  candidateReveal?: string | null;
  pendingRevealCount?: number;
  revealedCandidateCount?: number;
  nominationDeadline?: string | null;
  votingClosesAt?: string | null;
};

export type ContestPhaseDisplay =
  | {
      kind: "countdown";
      prefix: string;
      closesAt: string;
      tone: ContestPhaseTone;
      expiredLabel: string;
    }
  | {
      kind: "label";
      label: string;
      tone: ContestPhaseTone;
    };

function isClosingCountdown(
  open: boolean,
  closesAt: string | null | undefined,
  nowMs: number,
): closesAt is string {
  if (!open || !closesAt) return false;
  const end = Date.parse(closesAt);
  return Number.isFinite(end) && end > nowMs;
}

/** Phase badge content: live countdown when a close deadline is active, else static label. */
export function deriveContestPhaseDisplay(
  input: ContestPhaseInput & { nowMs?: number },
): ContestPhaseDisplay {
  const now = input.nowMs ?? Date.now();

  if (isClosingCountdown(input.votingOpen, input.votingClosesAt, now)) {
    return {
      kind: "countdown",
      prefix: "Voting: closing in",
      closesAt: input.votingClosesAt,
      tone: "voting",
      expiredLabel: "Voting closed",
    };
  }

  if (isClosingCountdown(input.nominationsOpen, input.nominationDeadline, now)) {
    return {
      kind: "countdown",
      prefix: "Nominations: closing in",
      closesAt: input.nominationDeadline,
      tone: "nominations",
      expiredLabel: "Nominations closed",
    };
  }

  const tone = deriveContestPhaseTone(input);
  const label = deriveContestPhaseLabel(input);
  return { kind: "label", label, tone };
}

function isTimedNominationsPending(input: ContestPhaseInput): boolean {
  return isNominationsNotStartedYet(input);
}

/**
 * Timed nomination window is configured, but the host has not pressed Start yet
 * (no deadline assigned). Distinct from “nominations closed / completed”.
 */
export function isNominationsNotStartedYet(input: {
  nominationsOpen: boolean;
  nominationDurationSeconds?: number | null;
  nominationDeadline?: string | null;
}): boolean {
  if (input.nominationsOpen) return false;
  const timed =
    typeof input.nominationDurationSeconds === "number" &&
    input.nominationDurationSeconds > 0;
  return timed && !input.nominationDeadline;
}

function adminRevealProgress(input: ContestPhaseInput) {
  const reveal = parseCandidateReveal(input.candidateReveal);
  if (!isAdminCandidateReveal(reveal)) return null;
  const pending = Math.max(0, input.pendingRevealCount ?? 0);
  const revealed = Math.max(0, input.revealedCandidateCount ?? 0);
  const kind = resolveCandidateRevealStatus({
    needsAdminReveal: true,
    pendingCount: pending,
    revealedCount: revealed,
    votingOrLater:
      input.status === "voting" || input.status === "finished",
  });
  // While nominations are still open and nothing is revealed yet, stay on
  // “Nominations open” — not “Revealing candidates · 0 of N”.
  if (kind === "revealing" && revealed === 0 && input.nominationsOpen) {
    return null;
  }
  return { kind, pending, revealed, total: pending + revealed };
}

export function deriveContestPhaseTone(input: ContestPhaseInput): ContestPhaseTone {
  const {
    status,
    nominationsOpen,
    votingOpen,
    resultsPhase,
    resultsReveal = null,
    resultsRevealStep = 0,
    nominatorRevealStep = 0,
  } = input;

  if (status === "payment_pending") return "waiting";
  if (status === "expired") return "expired";
  if (status === "finished") {
    if (resultsPhase === "done") return "finished";

    if (resultsPhase === "nominators") {
      return nominatorRevealStep > 0 ? "revealing" : "waiting";
    }

    // Instant results are fully available as soon as voting ends.
    if (isInstantResultsReveal(resultsReveal ?? "")) return "revealing";

    if (resultsRevealStep <= 0) return "waiting";
    return "revealing";
  }
  if (status === "voting") {
    return votingOpen ? "voting" : "waiting";
  }

  const revealProgress = adminRevealProgress(input);
  if (revealProgress?.kind === "revealing") return "revealing";

  if (nominationsOpen) return "nominations";
  return "waiting";
}

export function deriveContestPhaseLabel(input: ContestPhaseInput): string {
  const {
    status,
    nominationsOpen,
    votingOpen,
    resultsPhase,
    resultsReveal = null,
    resultsRevealStep = 0,
    nominatorRevealStep = 0,
    candidateSource = null,
  } = input;

  if (status === "payment_pending") return "Payment pending — tap to unlock";
  if (status === "expired") return "Expired";
  if (status === "finished") {
    if (resultsPhase === "done") return "Finished";

    if (resultsPhase === "nominators") {
      // Do not treat candidate results_reveal=immediate as “nominator started”.
      if (nominatorRevealStep <= 0) {
        return "Voting closed · Waiting for results";
      }
      return "Presenting nominator ranking";
    }

    // candidates phase (or unknown)
    if (isInstantResultsReveal(resultsReveal ?? "")) {
      // Full ranking is visible; host may still click Finish presentation.
      return "Results ready";
    }
    if (resultsRevealStep <= 0) {
      return "Voting closed · Waiting for results";
    }
    return "Presenting results";
  }
  if (status === "voting") {
    return votingOpen
      ? resultsReveal === "live"
        ? "Voting open · Live results"
        : "Voting open"
      : "Voting closed · Waiting for results";
  }

  // status === "open" — sync with Candidates “revealing candidates · N of M”
  const revealProgress = adminRevealProgress(input);
  if (revealProgress?.kind === "revealing") {
    if (revealProgress.total > 0) {
      return `Revealing candidates · ${revealProgress.revealed} of ${revealProgress.total}`;
    }
    return "Revealing candidates";
  }
  if (revealProgress?.kind === "complete") {
    return "Candidates revealed · Waiting for voting";
  }

  if (nominationsOpen) return "Nominations open";

  // Timed windows stay closed until the host starts them.
  if (isTimedNominationsPending(input)) {
    return "Waiting to start nominations";
  }
  // Curated contests skip participant nominations.
  if (candidateSource === "curated") {
    return "Waiting for voting";
  }
  return "Nominations closed · Waiting for voting";
}

export function isContestPhaseFinished(input: {
  status: string;
  resultsPhase: string | null;
}): boolean {
  return input.status === "finished" && input.resultsPhase === "done";
}

/** Build reveal counts for phase labels from candidate status rows. */
export function phaseRevealCountsFromCandidates(
  rows: Array<{ status: string }>,
): Pick<ContestPhaseInput, "pendingRevealCount" | "revealedCandidateCount"> {
  const progress = countCandidateRevealProgress(rows);
  return {
    pendingRevealCount: progress.pendingCount,
    revealedCandidateCount: progress.revealedCount,
  };
}
