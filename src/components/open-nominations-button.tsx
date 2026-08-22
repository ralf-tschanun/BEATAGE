"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  openNominationsAction,
  type ContestActionState,
} from "@/app/actions/contest";
import { broadcastContestResync } from "@/components/contest-live-refresh";
import { Button } from "@/components/ui/button";
import { formatNominationDuration } from "@/lib/nomination-duration";

const initialState: ContestActionState = null;

type OpenNominationsButtonProps = {
  contestId: string;
  joinCode: string;
  /** When set, starting nominations begins this countdown for everyone. */
  nominationDurationSeconds?: number | null;
  /** When true, the open/start action uses the default (focused) button. */
  emphasized?: boolean;
};

export function OpenNominationsButton({
  contestId,
  joinCode,
  nominationDurationSeconds = null,
  emphasized = false,
}: OpenNominationsButtonProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    openNominationsAction,
    initialState,
  );
  const hasTimedWindow =
    typeof nominationDurationSeconds === "number" &&
    nominationDurationSeconds >= 1;

  useEffect(() => {
    if (!state?.success) return;
    void broadcastContestResync(contestId);
    router.refresh();
  }, [state, router, contestId]);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="contestId" value={contestId} />
      <input type="hidden" name="joinCode" value={joinCode} />
      <p className="text-sm text-muted-foreground">
        {hasTimedWindow ? (
          <>
            Nominations are closed. When you start them, everyone gets{" "}
            {formatNominationDuration(nominationDurationSeconds)} until
            nominations close automatically — the same countdown is shown to all
            participants.
          </>
        ) : (
          <>
            Nominations are closed. Reopen to let participants submit or edit
            nominations before you start voting.
          </>
        )}
      </p>
      <Button
        type="submit"
        variant={emphasized ? "default" : "outline"}
        disabled={pending}
      >
        {pending
          ? hasTimedWindow
            ? "Starting…"
            : "Reopening…"
          : hasTimedWindow
            ? "Start nominations"
            : "Reopen nominations"}
      </Button>
      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
