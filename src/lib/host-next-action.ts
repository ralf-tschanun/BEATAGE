import type { ResultsPhase } from "@/lib/plans";

/** Next primary action the host should take in Host Area. */
export type HostNextAction =
  | "close_nominations"
  | "open_nominations"
  | "reveal_candidates"
  | "start_voting"
  | "close_voting"
  | "advance_results"
  | null;

/**
 * Contest run-of-show priority for highlighting the next host control.
 * One step at a time so the host always sees what to do next.
 */
export function resolveHostNextAction(input: {
  status: string;
  nominationsOpen: boolean;
  votingOpen: boolean;
  needsAdminReveal: boolean;
  pendingRevealCount: number;
  candidateCount: number;
  resultsPhase: ResultsPhase | string | null;
  /** When true, skip nomination open/close as the primary host step. */
  curatedOnly?: boolean;
}): HostNextAction {
  if (input.status === "finished") {
    if (input.resultsPhase !== "done") return "advance_results";
    return null;
  }

  if (input.status === "voting") {
    if (input.votingOpen) return "close_voting";
    return "start_voting";
  }

  // status === "open" (and similar pre-voting states)
  if (input.nominationsOpen && !input.curatedOnly) return "close_nominations";

  if (input.needsAdminReveal && input.pendingRevealCount > 0) {
    return "reveal_candidates";
  }

  if (input.candidateCount >= 1) return "start_voting";

  // Nothing to vote on yet — collect nominations / curated adds again
  return "open_nominations";
}
