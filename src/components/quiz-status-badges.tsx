"use client";

import { useEffect, useMemo, useState } from "react";
import {
  subscribeQuizPlay,
  type QuizPlaySnapshot,
} from "@/components/quiz-live-refresh";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  deriveQuizPhaseDisplay,
  QUIZ_PHASE_BADGE_CLASS,
  quizPhaseBadgeVariant,
  type QuizPhaseInput,
} from "@/lib/quiz-phase";
import type { OverallReveal } from "@/lib/quiz-settings";
import { quizSourceLabel } from "@/lib/quiz-settings";

type QuizStatusBadgesProps = {
  quizId: string;
  quizSource: string;
  initialQuizStatus: string;
  initialHasActiveRound: boolean;
  initialCurrentRoundNumber: number;
  initialAutoInterrupted: boolean;
  initialOverallReveal: OverallReveal;
  initialLeaderboardRevealStep: number;
  initialLeaderboardCount: number;
};

export function QuizStatusBadges({
  quizId,
  quizSource,
  initialQuizStatus,
  initialHasActiveRound,
  initialCurrentRoundNumber,
  initialAutoInterrupted,
  initialOverallReveal,
  initialLeaderboardRevealStep,
  initialLeaderboardCount,
}: QuizStatusBadgesProps) {
  const [phase, setPhase] = useState<QuizPhaseInput>({
    quizStatus: initialQuizStatus,
    hasActiveRound: initialHasActiveRound,
    currentRoundNumber: initialCurrentRoundNumber,
    autoInterrupted: initialAutoInterrupted,
    quizSource,
    overallReveal: initialOverallReveal,
    leaderboardRevealStep: initialLeaderboardRevealStep,
    leaderboardCount: initialLeaderboardCount,
  });

  useEffect(() => {
    setPhase({
      quizStatus: initialQuizStatus,
      hasActiveRound: initialHasActiveRound,
      currentRoundNumber: initialCurrentRoundNumber,
      autoInterrupted: initialAutoInterrupted,
      quizSource,
      overallReveal: initialOverallReveal,
      leaderboardRevealStep: initialLeaderboardRevealStep,
      leaderboardCount: initialLeaderboardCount,
    });
  }, [
    initialQuizStatus,
    initialHasActiveRound,
    initialCurrentRoundNumber,
    initialAutoInterrupted,
    quizSource,
    initialOverallReveal,
    initialLeaderboardRevealStep,
    initialLeaderboardCount,
  ]);

  useEffect(() => {
    return subscribeQuizPlay(quizId, (patch) => {
      if (patch.type !== "replace") return;
      const snapshot: QuizPlaySnapshot = patch.snapshot;
      setPhase({
        quizStatus: snapshot.quizStatus,
        hasActiveRound: Boolean(snapshot.activeRound),
        currentRoundNumber: snapshot.currentRoundNumber,
        autoInterrupted: snapshot.autoInterrupted,
        quizSource,
        overallReveal: snapshot.settings.overallReveal,
        leaderboardRevealStep: snapshot.leaderboardRevealStep,
        leaderboardCount: snapshot.leaderboard.length,
      });
    });
  }, [quizId, quizSource]);

  const display = useMemo(() => deriveQuizPhaseDisplay(phase), [phase]);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <Badge
        variant={quizPhaseBadgeVariant(display.tone)}
        className={cn(
          "w-fit max-w-full shrink truncate font-medium",
          QUIZ_PHASE_BADGE_CLASS[display.tone],
        )}
        title={display.label}
      >
        {display.label}
      </Badge>
      <span className="text-muted-foreground">· {quizSourceLabel(quizSource)}</span>
    </div>
  );
}
