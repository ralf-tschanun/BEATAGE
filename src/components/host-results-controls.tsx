"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  advanceResultsRevealAction,
  type ContestActionState,
} from "@/app/actions/contest";
import { broadcastContestResync } from "@/components/contest-live-refresh";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { scrollToSection } from "@/lib/scroll";
import {
  isInstantResultsReveal,
  isSteppedPlaceReveal,
  nominatorRevealMode,
  type NominatorRankingWhen,
  type NominatorResultsReveal,
  type ResultsPhase,
  type ResultsReveal,
} from "@/lib/plans";

const initialState: ContestActionState = null;

type HostResultsControlsProps = {
  contestId: string;
  joinCode: string;
  resultsReveal: ResultsReveal;
  resultsPhase: ResultsPhase;
  nominatorRanking: boolean;
  nominatorRankingWhen: NominatorRankingWhen;
  nominatorResultsReveal: NominatorResultsReveal;
  candidateStep: number;
  candidateMaxStep: number;
  candidateComplete: boolean;
  nominatorStep: number;
  nominatorMaxStep: number;
  nominatorComplete: boolean;
  /** Photos marked delete-on-finish (cleared when presentation ends). */
  pendingPhotoDeleteCount?: number;
  /** When true, the next presentation action uses the default (focused) button. */
  emphasized?: boolean;
};

function nextActionLabel(input: {
  resultsPhase: ResultsPhase;
  resultsReveal: ResultsReveal;
  nominatorRanking: boolean;
  nominatorRankingWhen: NominatorRankingWhen;
  nominatorResultsReveal: NominatorResultsReveal;
  candidateComplete: boolean;
  nominatorComplete: boolean;
  candidateStep: number;
  nominatorStep: number;
}): string {
  const nomMode = nominatorRevealMode(
    input.nominatorResultsReveal,
    input.nominatorRankingWhen,
  );

  if (input.resultsPhase === "candidates") {
    if (!input.candidateComplete && !isInstantResultsReveal(input.resultsReveal)) {
      return input.resultsReveal === "last_to_first"
        ? input.candidateStep === 0
          ? "Reveal last place"
          : "Reveal next place"
        : input.candidateStep === 0
          ? "Reveal first ballot"
          : "Reveal next ballot";
    }
    if (input.nominatorRanking && input.nominatorRankingWhen === "after") {
      return "Continue to nominator ranking";
    }
    return "Finish presentation";
  }

  if (input.resultsPhase === "nominators") {
    if (!input.nominatorComplete && isSteppedPlaceReveal(nomMode)) {
      if (nomMode === "first_to_last") {
        return input.nominatorStep === 0
          ? "Reveal first nominator place"
          : "Reveal next nominator place";
      }
      return input.nominatorStep === 0
        ? "Reveal last nominator place"
        : "Reveal next nominator place";
    }
    if (input.nominatorRankingWhen === "before") {
      return "Continue to candidate results";
    }
    return "Finish presentation";
  }

  return "Continue";
}

export function HostResultsControls({
  contestId,
  joinCode,
  resultsReveal,
  resultsPhase,
  nominatorRanking,
  nominatorRankingWhen,
  nominatorResultsReveal,
  candidateStep,
  candidateMaxStep,
  candidateComplete,
  nominatorStep,
  nominatorMaxStep,
  nominatorComplete,
  pendingPhotoDeleteCount = 0,
  emphasized = true,
}: HostResultsControlsProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    advanceResultsRevealAction,
    initialState,
  );

  useEffect(() => {
    if (!state?.success) return;
    setConfirmOpen(false);
    void broadcastContestResync(contestId);
    router.refresh();
    scrollToSection("results-presentation");
  }, [state, router, contestId]);

  const label = useMemo(
    () =>
      nextActionLabel({
        resultsPhase,
        resultsReveal,
        nominatorRanking,
        nominatorRankingWhen,
        nominatorResultsReveal,
        candidateComplete,
        nominatorComplete,
        candidateStep,
        nominatorStep,
      }),
    [
      resultsPhase,
      resultsReveal,
      nominatorRanking,
      nominatorRankingWhen,
      nominatorResultsReveal,
      candidateComplete,
      nominatorComplete,
      candidateStep,
      nominatorStep,
    ],
  );

  if (resultsPhase === "done") {
    return (
      <p className="text-sm text-muted-foreground">
        All result presentations are complete.
      </p>
    );
  }

  const nomMode = nominatorRevealMode(
    nominatorResultsReveal,
    nominatorRankingWhen,
  );
  let disabled = false;
  if (resultsPhase === "candidates" && !isInstantResultsReveal(resultsReveal)) {
    disabled = pending || (candidateMaxStep < 1 && !candidateComplete);
  }
  if (resultsPhase === "nominators" && isSteppedPlaceReveal(nomMode)) {
    disabled = pending || (nominatorMaxStep < 1 && !nominatorComplete);
  }

  const stepLabel =
    resultsPhase === "candidates" && !isInstantResultsReveal(resultsReveal)
      ? `Candidate reveal ${Math.min(candidateStep, candidateMaxStep)} of ${candidateMaxStep}`
      : resultsPhase === "nominators" && isSteppedPlaceReveal(nomMode)
        ? `Nominator reveal ${Math.min(nominatorStep, nominatorMaxStep)} of ${nominatorMaxStep}`
        : null;

  const isFinish = label === "Finish presentation";
  const needsPhotoWarning = isFinish && pendingPhotoDeleteCount > 0;

  return (
    <div className="space-y-2">
      {stepLabel ||
      (resultsPhase === "candidates" ? candidateComplete : nominatorComplete) ? (
        <p className="text-sm text-muted-foreground">
          {(resultsPhase === "candidates" ? candidateComplete : nominatorComplete) ? (
            <span className="font-medium text-destructive">complete</span>
          ) : (
            <span className="font-medium text-amber-700 dark:text-amber-400">
              revealing…
            </span>
          )}
          {stepLabel ? ` · ${stepLabel}` : null}
        </p>
      ) : null}

      {needsPhotoWarning ? (
        <>
          <Button
            type="button"
            variant={emphasized ? "default" : "outline"}
            disabled={disabled || pending}
            onClick={() => setConfirmOpen(true)}
          >
            {pending ? "Updating…" : label}
          </Button>
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Finish presentation?</DialogTitle>
                <DialogDescription>
                  {pendingPhotoDeleteCount === 1
                    ? "1 photo was marked to be deleted when the contest ends. It will be permanently removed now and will not appear if anyone opens this contest later."
                    : `${pendingPhotoDeleteCount} photos were marked to be deleted when the contest ends. They will be permanently removed now and will not appear if anyone opens this contest later.`}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setConfirmOpen(false)}
                >
                  Cancel
                </Button>
                <form action={formAction}>
                  <input type="hidden" name="contestId" value={contestId} />
                  <input type="hidden" name="joinCode" value={joinCode} />
                  <Button type="submit" disabled={pending}>
                    {pending ? "Finishing…" : "Finish & delete photos"}
                  </Button>
                </form>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="contestId" value={contestId} />
          <input type="hidden" name="joinCode" value={joinCode} />
          <Button
            type="submit"
            variant={emphasized ? "default" : "outline"}
            disabled={disabled || pending}
          >
            {pending ? "Updating…" : label}
          </Button>
        </form>
      )}

      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
