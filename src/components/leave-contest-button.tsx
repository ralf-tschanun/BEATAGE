"use client";

import { useActionState, useState } from "react";
import {
  leaveContestAction,
  type ContestActionState,
} from "@/app/actions/contest";
import { Button } from "@/components/ui/button";

const initialState: ContestActionState = null;

type LeaveContestButtonProps = {
  contestId: string;
  contestTitle: string;
};

export function LeaveContestButton({
  contestId,
  contestTitle,
}: LeaveContestButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(
    leaveContestAction,
    initialState,
  );

  if (!confirming) {
    return (
      <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
        Leave contest
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="contestId" value={contestId} />
      <p className="text-sm text-muted-foreground">
        Leave “{contestTitle}”? You can join again later with the invite link if seats
        are still available.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Leaving…" : "Yes, leave contest"}
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
