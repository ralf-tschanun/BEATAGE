"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { joinQuizAction, type QuizActionState } from "@/app/actions/quiz";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: QuizActionState = null;

type JoinQuizDialogProps = {
  joinCode: string;
  quizTitle: string;
  description?: string | null;
  memberCount: number;
  maxMembers: number | null;
  blockedMessage?: string | null;
  defaultDisplayName?: string | null;
};

export function JoinQuizDialog({
  joinCode,
  quizTitle,
  description,
  memberCount,
  maxMembers,
  blockedMessage,
  defaultDisplayName,
}: JoinQuizDialogProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(joinQuizAction, initialState);
  const initialName = defaultDisplayName?.trim() ?? "";

  useEffect(() => {
    if (state?.redirectTo && typeof window !== "undefined") {
      window.location.assign(state.redirectTo);
    }
  }, [state?.redirectTo]);

  const participantsLabel = maxMembers
    ? `${memberCount} of ${maxMembers} players`
    : `${memberCount} player${memberCount === 1 ? "" : "s"}`;
  const details = [participantsLabel, description?.trim() || null]
    .filter(Boolean)
    .join(" · ");

  function closeToJoin() {
    if (pending) return;
    router.push("/join");
  }

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeToJoin();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Join quiz</DialogTitle>
          <DialogDescription>
            {quizTitle}
            {details ? ` · ${details}` : ""}
          </DialogDescription>
        </DialogHeader>

        {blockedMessage ? (
          <>
            <p className="text-sm text-destructive" role="alert">
              {blockedMessage}
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeToJoin}>
                Back
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="joinCode" value={joinCode} />
            <div className="space-y-2">
              <Label htmlFor="displayName">Your name</Label>
              <Input
                id="displayName"
                name="displayName"
                placeholder="Sam"
                defaultValue={initialName}
                required
                maxLength={40}
                autoComplete="nickname"
                autoFocus
              />
              {initialName ? (
                <p className="text-xs text-muted-foreground">
                  Prefilled from your signed-in name. Change it only for this quiz if
                  you want.
                </p>
              ) : null}
            </div>

            {state?.error ? (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeToJoin}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Joining…" : "Join quiz"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
