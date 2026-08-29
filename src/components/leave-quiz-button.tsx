"use client";

import { useActionState, useEffect, useState } from "react";
import {
  leaveQuizAction,
  type QuizActionState,
} from "@/app/actions/quiz";
import { Button } from "@/components/ui/button";

const initialState: QuizActionState = null;

type LeaveQuizButtonProps = {
  quizId: string;
  quizTitle: string;
};

export function LeaveQuizButton({ quizId, quizTitle }: LeaveQuizButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(
    leaveQuizAction,
    initialState,
  );

  useEffect(() => {
    if (state?.redirectTo) {
      window.location.assign(state.redirectTo);
    }
  }, [state?.redirectTo]);

  if (!confirming) {
    return (
      <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
        Leave quiz
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="quizId" value={quizId} />
      <p className="text-sm text-muted-foreground">
        Leave “{quizTitle}”? You can join again later with the invite link if seats
        are still available.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Leaving…" : "Yes, leave quiz"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
      </div>
      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
