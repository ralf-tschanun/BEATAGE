"use client";

import { useActionState, useState } from "react";
import {
  cloneContestAction,
  type ContestActionState,
} from "@/app/actions/contest";
import { Button } from "@/components/ui/button";

const initialState: ContestActionState = null;

type CloneContestButtonProps = {
  contestId: string;
  contestTitle: string;
  candidateLabel?: string;
};

export function CloneContestButton({
  contestId,
  contestTitle,
  candidateLabel = "Candidate",
}: CloneContestButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(
    cloneContestAction,
    initialState,
  );

  if (!confirming) {
    return (
      <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
        Clone contest
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="contestId" value={contestId} />
      <p className="text-sm text-muted-foreground">
        Create a new contest like “{contestTitle}” with the same settings and{" "}
        {candidateLabel.toLowerCase()}s? Participants and votes are not copied.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Cloning…" : "Yes, clone for next match"}
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
