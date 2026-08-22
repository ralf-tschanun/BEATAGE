"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  closeNominationsAction,
  scheduleCloseNominationsAction,
  type ContestActionState,
} from "@/app/actions/contest";
import { broadcastContestResync } from "@/components/contest-live-refresh";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VotingCountdown } from "@/components/voting-countdown";

const initialState: ContestActionState = null;

type CloseNominationsButtonProps = {
  contestId: string;
  joinCode: string;
  nominationDeadline?: string | null;
  /** When true, the primary close action uses the default (focused) button. */
  emphasized?: boolean;
};

export function CloseNominationsButton({
  contestId,
  joinCode,
  nominationDeadline = null,
  emphasized = false,
}: CloseNominationsButtonProps) {
  const router = useRouter();
  const [closeInSeconds, setCloseInSeconds] = useState(30);
  const [closeState, closeAction, closePending] = useActionState(
    closeNominationsAction,
    initialState,
  );
  const [scheduleState, scheduleAction, schedulePending] = useActionState(
    scheduleCloseNominationsAction,
    initialState,
  );

  useEffect(() => {
    if (!scheduleState?.success && !closeState?.success) return;
    void broadcastContestResync(contestId);
    router.refresh();
  }, [scheduleState, closeState, router, contestId]);

  const scheduleSeconds = Math.min(
    3600,
    Math.max(5, Math.floor(Number(closeInSeconds) || 30)),
  );
  const hasCountdown = Boolean(nominationDeadline);

  return (
    <div className="space-y-4">
      {hasCountdown ? (
        <VotingCountdown
          closesAt={nominationDeadline}
          prefix="Nominations close automatically in"
          expiredLabel="Nomination deadline reached — nominations are closing."
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Closing nominations stops new submissions. You can still start voting
          later.
        </p>
      )}

      <form action={closeAction} className="space-y-2">
        <input type="hidden" name="contestId" value={contestId} />
        <input type="hidden" name="joinCode" value={joinCode} />
        <Button
          type="submit"
          variant={emphasized ? "default" : "outline"}
          disabled={closePending || schedulePending}
        >
          {closePending ? "Closing…" : "Close nominations now"}
        </Button>
        {closeState?.error ? (
          <p className="text-sm text-destructive" role="alert">
            {closeState.error}
          </p>
        ) : null}
      </form>

      <form action={scheduleAction} className="space-y-2">
        <input type="hidden" name="contestId" value={contestId} />
        <input type="hidden" name="joinCode" value={joinCode} />
        <input type="hidden" name="closeInSeconds" value={scheduleSeconds} />
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="close-noms-in-seconds">Close in (seconds)</Label>
            <Input
              id="close-noms-in-seconds"
              type="number"
              min={5}
              max={3600}
              step={1}
              value={closeInSeconds}
              onChange={(event) => setCloseInSeconds(Number(event.target.value))}
              className="w-28"
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={closePending || schedulePending}
          >
            {schedulePending
              ? "Scheduling…"
              : `Close nominations in ${scheduleSeconds}s`}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Starts a countdown everyone can see (default 30s). You can still close
          immediately above.
        </p>
        {scheduleState?.error ? (
          <p className="text-sm text-destructive" role="alert">
            {scheduleState.error}
          </p>
        ) : null}
        {scheduleState?.success ? (
          <p className="text-sm text-foreground" role="status">
            Countdown started.
          </p>
        ) : null}
      </form>
    </div>
  );
}
