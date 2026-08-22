import type { ReactNode } from "react";
import type { ResultsPhase, ResultsReveal } from "@/lib/plans";
import { isInstantResultsReveal } from "@/lib/plans";

const STATUS_CLASS = {
  live: "font-medium text-emerald-700 dark:text-emerald-400",
  revealing: "font-medium text-amber-700 dark:text-amber-400",
  done: "font-medium text-destructive",
} as const;

export type PresentationStatusKind = keyof typeof STATUS_CLASS;

/** Colored status chip for results / presentation card descriptions. */
export function PresentationStatusLabel({
  kind,
  children,
}: {
  kind: PresentationStatusKind;
  children: ReactNode;
}) {
  return <span className={STATUS_CLASS[kind]}>{children}</span>;
}

/** Status under Voting results title. */
export function votingResultsStatusKind(input: {
  showLiveResults: boolean;
  resultsComplete: boolean;
}): PresentationStatusKind {
  if (input.showLiveResults) return "live";
  if (input.resultsComplete) return "done";
  return "revealing";
}

export function votingResultsStatusText(kind: PresentationStatusKind): string {
  if (kind === "live") return "live ranking";
  if (kind === "done") return "Presentation completed";
  return "revealing…";
}

/** Status under Nominator ranking title. */
export function nominatorResultsStatusKind(complete: boolean): PresentationStatusKind {
  return complete ? "done" : "revealing";
}

export function nominatorResultsStatusText(kind: PresentationStatusKind): string {
  return kind === "done" ? "Presentation completed" : "revealing…";
}

/**
 * Status under Results presentation title (host controls).
 * Replaces the old "Phase: candidates|nominators|done" label.
 */
export function resultsPresentationStatusKind(input: {
  phase: ResultsPhase;
  resultsReveal: ResultsReveal;
  candidateComplete: boolean;
  nominatorComplete: boolean;
}): PresentationStatusKind {
  if (input.phase === "done") return "done";
  if (input.phase === "nominators") {
    return input.nominatorComplete ? "done" : "revealing";
  }
  // candidates phase
  if (
    input.candidateComplete ||
    isInstantResultsReveal(input.resultsReveal)
  ) {
    return "done";
  }
  return "revealing";
}

export function resultsPresentationStatusText(
  kind: PresentationStatusKind,
  phase: ResultsPhase,
): string {
  if (phase === "done") return "Presentation completed";
  if (phase === "nominators") {
    return kind === "done" ? "complete" : "revealing…";
  }
  return kind === "done" ? "Presentation completed" : "revealing…";
}
