"use client";

import { useActionState, useEffect, useState } from "react";
import {
  deleteQuizAction,
  type QuizActionState,
} from "@/app/actions/quiz";
import { Button } from "@/components/ui/button";

const initialState: QuizActionState = null;

type DeleteQuizButtonProps = {
  quizId: string;
  quizTitle: string;
};

export function DeleteQuizButton({ quizId, quizTitle }: DeleteQuizButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(
    deleteQuizAction,
    initialState,
  );

  useEffect(() => {
    if (state?.redirectTo) {
      window.location.assign(state.redirectTo);
    }
  }, [state?.redirectTo]);

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="destructive"
        onClick={() => setConfirming(true)}
      >
        Delete quiz
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="quizId" value={quizId} />
      <p className="text-sm text-destructive">
        Delete “{quizTitle}”? This removes the quiz and all players.
        You can create a new one afterwards.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Deleting…" : "Yes, delete permanently"}
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
