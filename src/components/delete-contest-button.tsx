"use client";

import { useActionState, useState } from "react";
import {
  deleteContestAction,
  type ContestActionState,
} from "@/app/actions/contest";
import { Button } from "@/components/ui/button";

const initialState: ContestActionState = null;

type DeleteContestButtonProps = {
  contestId: string;
  contestTitle: string;
};

export function DeleteContestButton({
  contestId,
  contestTitle,
}: DeleteContestButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(
    deleteContestAction,
    initialState,
  );

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="destructive"
        onClick={() => setConfirming(true)}
      >
        Delete contest
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="contestId" value={contestId} />
      <p className="text-sm text-destructive">
        Delete “{contestTitle}”? This removes the contest and all participants.
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
