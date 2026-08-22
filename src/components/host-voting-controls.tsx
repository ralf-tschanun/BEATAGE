"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  closeVotingAction,
  reopenVotingAction,
  scheduleCloseVotingAction,
  startVotingAction,
  type ContestActionState,
} from "@/app/actions/contest";
import { broadcastContestResync } from "@/components/contest-live-refresh";
import { ColoredVotingStatus } from "@/components/colored-voting-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VotingCountdown } from "@/components/voting-countdown";
import { isInstantResultsReveal, type ResultsReveal } from "@/lib/plans";

const initialState: ContestActionState = null;

type HostVotingControlsProps = {
  contestId: string;
  joinCode: string;
  status: string;
  votingOpen: boolean;
  candidateCount: number;
  pendingRevealCount?: number;
  votingCloseMode?: "manual" | "scheduled";
  votingClosesAt?: string | null;
  votingReopenedAt?: string | null;
  resultsPhase?: string | null;
  resultsReveal?: ResultsReveal;
  resultsRevealStep?: number;
  nominatorRevealStep?: number;
  /** Which voting action is the next host step (focused primary button). */
  emphasizedAction?: "start_voting" | "close_voting" | "reopen_voting" | null;
};

export function HostVotingControls({
  contestId,
  joinCode,
  status,
  votingOpen,
  candidateCount,
  pendingRevealCount = 0,
  votingCloseMode = "manual",
  votingClosesAt = null,
  votingReopenedAt = null,
  resultsPhase = "candidates",
  resultsReveal = "immediate",
  resultsRevealStep = 0,
  nominatorRevealStep = 0,
  emphasizedAction = null,
}: HostVotingControlsProps) {
  const router = useRouter();
  const [closeInSeconds, setCloseInSeconds] = useState(30);
  const [startState, startAction, startPending] = useActionState(
    startVotingAction,
    initialState,
  );
  const [closeState, closeAction, closePending] = useActionState(
    closeVotingAction,
    initialState,
  );
  const [reopenState, reopenAction, reopenPending] = useActionState(
    reopenVotingAction,
    initialState,
  );
  const [scheduleState, scheduleAction, schedulePending] = useActionState(
    scheduleCloseVotingAction,
    initialState,
  );

  useEffect(() => {
    if (
      !scheduleState?.success &&
      !reopenState?.success &&
      !startState?.success &&
      !closeState?.success
    ) {
      return;
    }
    void broadcastContestResync(contestId);
    router.refresh();
  }, [scheduleState, reopenState, startState, closeState, router, contestId]);

  const canStart = status === "open" || (status === "voting" && !votingOpen);
  const canClose = status === "voting" && votingOpen;
  const blockedByReveal = pendingRevealCount > 0;
  const hasCountdown =
    Boolean(votingClosesAt) &&
    canClose &&
    Date.parse(votingClosesAt!) > Date.now();
  const scheduleSeconds = Math.min(
    3600,
    Math.max(5, Math.floor(Number(closeInSeconds) || 30)),
  );

  const canReopenVoting =
    status === "finished" &&
    resultsPhase !== "done" &&
    !isInstantResultsReveal(resultsReveal ?? "immediate") &&
    resultsRevealStep <= 0 &&
    nominatorRevealStep <= 0;

  const presentationStarted =
    status === "finished" &&
    resultsPhase !== "done" &&
    !canReopenVoting;

  if (status === "finished" && !canReopenVoting) {
    return (
      <div className="space-y-2">
        <ColoredVotingStatus
          votingOpen={false}
          votingClosesAt={null}
          votingReopenedAt={null}
        />
        <p className="text-sm text-muted-foreground">
          {presentationStarted
            ? "Results presentation is underway."
            : "Results are shown below."}
        </p>
      </div>
    );
  }

  if (canReopenVoting) {
    return (
      <div className="space-y-3">
        <ColoredVotingStatus
          votingOpen={false}
          votingClosesAt={null}
          votingReopenedAt={null}
        />
        <p className="text-sm text-muted-foreground">
          Voting was closed early. Reopen to let participants vote or change
          ballots. The results presentation will reset to the beginning.
        </p>
        <form action={reopenAction} className="space-y-2">
          <input type="hidden" name="contestId" value={contestId} />
          <input type="hidden" name="joinCode" value={joinCode} />
          <Button
            type="submit"
            variant={
              emphasizedAction === "reopen_voting" ? "default" : "outline"
            }
            disabled={reopenPending}
          >
            {reopenPending ? "Reopening…" : "Reopen voting"}
          </Button>
          {reopenState?.error ? (
            <p className="text-sm text-destructive" role="alert">
              {reopenState.error}
            </p>
          ) : null}
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {canStart ? (
        <form action={startAction} className="space-y-2">
          <input type="hidden" name="contestId" value={contestId} />
          <input type="hidden" name="joinCode" value={joinCode} />
          <p className="text-sm text-muted-foreground">
            Starting voting closes nominations and lets participants submit ballots
            ({candidateCount} candidate{candidateCount === 1 ? "" : "s"}).
          </p>
          {votingCloseMode === "scheduled" && votingClosesAt ? (
            <p className="text-sm text-muted-foreground">
              Scheduled end: {new Date(votingClosesAt).toLocaleString()}
            </p>
          ) : null}
          <Button
            type="submit"
            variant={
              emphasizedAction === "start_voting" ? "default" : "outline"
            }
            disabled={startPending || candidateCount < 1 || blockedByReveal}
          >
            {startPending ? "Starting…" : "Start voting"}
          </Button>
          {candidateCount < 1 ? (
            <p className="text-sm text-destructive">Add at least one candidate first.</p>
          ) : null}
          {blockedByReveal ? (
            <p className="text-sm text-destructive">
              Reveal {pendingRevealCount} pending candidate
              {pendingRevealCount === 1 ? "" : "s"} before starting voting.
            </p>
          ) : null}
          {startState?.error ? (
            <p className="text-sm text-destructive" role="alert">
              {startState.error}
            </p>
          ) : null}
        </form>
      ) : null}

      {canClose ? (
        <div className="space-y-4">
          {hasCountdown ? (
            <VotingCountdown
              closesAt={votingClosesAt}
              prefix="Voting ends automatically in"
              expiredLabel="Voting deadline reached — closing soon or refresh the page."
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Closing voting locks all ballots and reveals the final ranking.
            </p>
          )}

          <form action={closeAction} className="space-y-2">
            <input type="hidden" name="contestId" value={contestId} />
            <input type="hidden" name="joinCode" value={joinCode} />
            <Button
              type="submit"
              variant={
                emphasizedAction === "close_voting" ? "default" : "outline"
              }
              disabled={closePending || schedulePending}
            >
              {closePending ? "Closing…" : "Close voting now & show results"}
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
                <Label htmlFor="close-in-seconds">Close in (seconds)</Label>
                <Input
                  id="close-in-seconds"
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
                  : `Close voting in ${scheduleSeconds}s & show results`}
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
      ) : null}
    </div>
  );
}
