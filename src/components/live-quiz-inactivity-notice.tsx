"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isInactivityQuizInterrupt } from "@/lib/quiz-settings";

type LiveQuizInactivityNoticeProps = {
  autoInterrupted: boolean;
  autoEmptyStreak: number;
  emptyStreakThreshold: number;
  /** Increment after a sync detects an inactivity interrupt (same tab). */
  notifySignal?: number;
};

export function LiveQuizInactivityNotice({
  autoInterrupted,
  autoEmptyStreak,
  emptyStreakThreshold,
  notifySignal = 0,
}: LiveQuizInactivityNoticeProps) {
  const [open, setOpen] = useState(false);
  const [emptyRoundCount, setEmptyRoundCount] = useState(emptyStreakThreshold);
  const dismissedRef = useRef(false);
  const prevInterruptedRef = useRef(autoInterrupted);

  const maybeShow = useCallback(
    (streak: number) => {
      if (
        !isInactivityQuizInterrupt(true, streak, emptyStreakThreshold) ||
        dismissedRef.current
      ) {
        return;
      }
      setEmptyRoundCount(Math.max(streak, emptyStreakThreshold));
      setOpen(true);
    },
    [emptyStreakThreshold],
  );

  useEffect(() => {
    if (!autoInterrupted) {
      dismissedRef.current = false;
      prevInterruptedRef.current = false;
      return;
    }
    if (!prevInterruptedRef.current) {
      maybeShow(autoEmptyStreak);
    }
    prevInterruptedRef.current = autoInterrupted;
  }, [autoInterrupted, autoEmptyStreak, maybeShow]);

  useEffect(() => {
    if (notifySignal > 0) {
      maybeShow(autoEmptyStreak);
    }
  }, [notifySignal, autoEmptyStreak, maybeShow]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) dismissedRef.current = true;
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quiz interrupted due to inactivity</DialogTitle>
          <DialogDescription>
            {emptyRoundCount} song{emptyRoundCount === 1 ? "" : "s"} in a row had
            no guesses from players. The quiz is paused so you can check whether
            everyone is still with you. Press{" "}
            <span className="font-medium text-foreground">Resume</span> when you are
            ready to continue.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={() => setOpen(false)}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
