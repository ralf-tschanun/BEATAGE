import {
  isQuizLeaderboardRevealComplete,
  presentsLeaderboardAtEnd,
  type BeatageQuizSettings,
  type OverallReveal,
} from "@/lib/quiz-settings";

export type QuizPhaseTone =
  | "guessing"
  | "round_closed"
  | "interrupted"
  | "presenting"
  | "finished"
  | "waiting";

/** Shared phase-badge colors for quiz page (MyContest-style). */
export const QUIZ_PHASE_BADGE_CLASS: Record<QuizPhaseTone, string> = {
  guessing:
    "border-emerald-200/80 bg-emerald-100 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/80 dark:text-emerald-300",
  round_closed: "border-border bg-muted text-muted-foreground",
  interrupted:
    "border-destructive/30 bg-destructive/10 text-destructive dark:border-destructive/40 dark:bg-destructive/15",
  presenting:
    "border-amber-200/80 bg-amber-100 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/80 dark:text-amber-300",
  finished:
    "border-destructive/30 bg-destructive/10 text-destructive dark:border-destructive/40 dark:bg-destructive/15",
  waiting: "border-border bg-muted text-muted-foreground",
};

export function quizPhaseBadgeVariant(
  tone: QuizPhaseTone,
): "destructive" | "outline" {
  return tone === "finished" || tone === "interrupted" ? "destructive" : "outline";
}

export type QuizPhaseInput = {
  quizStatus: string;
  hasActiveRound: boolean;
  currentRoundNumber: number;
  autoInterrupted: boolean;
  quizSource: string;
  overallReveal: OverallReveal;
  leaderboardRevealStep: number;
  leaderboardCount: number;
};

export type QuizPhaseDisplay = {
  label: string;
  tone: QuizPhaseTone;
};

/** Colored status label under the quiz title. */
export function deriveQuizPhaseDisplay(input: QuizPhaseInput): QuizPhaseDisplay {
  const isFinished =
    input.quizStatus === "finished" || input.quizStatus === "expired";
  const presentAtEnd = presentsLeaderboardAtEnd({
    overallReveal: input.overallReveal,
  } as BeatageQuizSettings);

  if (input.quizStatus === "payment_pending") {
    return { label: "Payment pending", tone: "waiting" };
  }

  if (isFinished) {
    if (
      presentAtEnd &&
      input.leaderboardCount > 0 &&
      !isQuizLeaderboardRevealComplete(
        input.overallReveal,
        input.leaderboardRevealStep,
        input.leaderboardCount,
      )
    ) {
      return { label: "Presenting Results", tone: "presenting" };
    }
    return { label: "Finished", tone: "finished" };
  }

  if (input.autoInterrupted && input.quizSource === "spotify_live") {
    return { label: "Interrupted", tone: "interrupted" };
  }

  if (input.hasActiveRound) {
    return { label: "Guessing", tone: "guessing" };
  }

  if (input.currentRoundNumber > 0 || input.quizStatus === "playing") {
    return { label: "Round closed", tone: "round_closed" };
  }

  return { label: "Waiting for host", tone: "waiting" };
}
