"use client";

import { useEffect, useState } from "react";
import { InviteShare } from "@/components/invite-share";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type QuizPageHeaderProps = {
  title: string;
  joinCode: string;
  joinUrl: string;
  /** Open invite dialog on mount (e.g. after create). */
  openInviteOnMount?: boolean;
  isHost: boolean;
};

export function QuizPageHeader({
  title,
  joinCode,
  joinUrl,
  openInviteOnMount = false,
  isHost,
}: QuizPageHeaderProps) {
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    if (!openInviteOnMount) return;
    setInviteOpen(true);
  }, [openInviteOnMount]);

  useEffect(() => {
    function onOpenInvite() {
      setInviteOpen(true);
    }
    window.addEventListener("quiz:open-invite", onOpenInvite);
    return () => window.removeEventListener("quiz:open-invite", onOpenInvite);
  }, []);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={() => setInviteOpen(true)}>
          Invite
        </Button>
        {isHost ? (
          <p className="text-sm text-muted-foreground">
            Share the invite so players can join, then start rounds below.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Waiting for the host to start the next round.
          </p>
        )}
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite players</DialogTitle>
            <DialogDescription>
              Share the link or join code so others can enter this quiz.
            </DialogDescription>
          </DialogHeader>
          <InviteShare joinUrl={joinUrl} joinCode={joinCode} contestTitle={title} />
        </DialogContent>
      </Dialog>
    </>
  );
}
