"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  removeContestMemberAction,
  type ContestActionState,
} from "@/app/actions/contest";
import { broadcastContestResync } from "@/components/contest-live-refresh";
import { Button } from "@/components/ui/button";

const initialState: ContestActionState = null;

type RemoveParticipantButtonProps = {
  contestId: string;
  joinCode: string;
  userId: string;
  displayName: string;
};

export function RemoveParticipantButton({
  contestId,
  joinCode,
  userId,
  displayName,
}: RemoveParticipantButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(
    removeContestMemberAction,
    initialState,
  );

  useEffect(() => {
    if (!state?.success) return;
    setConfirming(false);
    void broadcastContestResync(contestId);
    router.refresh();
  }, [state, router, contestId]);

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-destructive hover:text-destructive"
        onClick={() => setConfirming(true)}
      >
        Remove
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1">
      <input type="hidden" name="contestId" value={contestId} />
      <input type="hidden" name="joinCode" value={joinCode} />
      <input type="hidden" name="userId" value={userId} />
      <span className="text-xs text-muted-foreground">Remove {displayName}?</span>
      <Button type="submit" variant="destructive" size="sm" disabled={pending}>
        {pending ? "…" : "Yes"}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => setConfirming(false)}
      >
        No
      </Button>
      {state?.error ? (
        <p className="basis-full text-xs text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
