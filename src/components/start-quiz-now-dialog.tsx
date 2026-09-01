"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type StartQuizNowDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending?: boolean;
  /** True when a pre-round is currently open for guesses. */
  hasActiveRound: boolean;
  /** True when a track is playing or a pre-round is open. */
  canStartWithThisSong: boolean;
  onChoose: (includeCurrentSong: boolean) => void;
};

/** Host chooses whether Round 1 is the current song or the next one. */
export function StartQuizNowDialog({
  open,
  onOpenChange,
  pending = false,
  hasActiveRound,
  canStartWithThisSong,
  onChoose,
}: StartQuizNowDialogProps) {
  function choose(includeCurrentSong: boolean) {
    if (pending) return;
    onOpenChange(false);
    onChoose(includeCurrentSong);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Start the quiz</DialogTitle>
          <DialogDescription>When should Round 1 begin?</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {canStartWithThisSong ? (
            <div className="space-y-1.5">
              <Button
                type="button"
                className="w-full"
                disabled={pending}
                onClick={() => choose(true)}
              >
                With this song
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                {hasActiveRound
                  ? "Turns the current pre-round into Round 1. Guesses already in will count."
                  : "Opens Round 1 for the current track."}
              </p>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Button
              type="button"
              variant={canStartWithThisSong ? "outline" : "default"}
              className="w-full"
              disabled={pending}
              onClick={() => choose(false)}
            >
              With the next song
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Closes the warm-up. Round 1 opens when the next track starts.
            </p>
          </div>
        </div>

        <DialogFooter className="sm:justify-stretch">
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
