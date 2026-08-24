"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ScrollIcon, UserPlusIcon } from "@phosphor-icons/react";
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
  rulesContent: ReactNode;
};

export function QuizPageHeader({
  title,
  joinCode,
  joinUrl,
  openInviteOnMount = false,
  rulesContent,
}: QuizPageHeaderProps) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

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
      <div className="flex items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold leading-tight tracking-tight">
          {title}
        </h1>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            onClick={() => setRulesOpen(true)}
            aria-label="Quiz rules"
            title="Quiz rules"
          >
            <ScrollIcon />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            onClick={() => setInviteOpen(true)}
            aria-label="Invite players"
            title="Invite"
          >
            <UserPlusIcon />
          </Button>
        </div>
      </div>

      <Dialog open={rulesOpen} onOpenChange={setRulesOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Quiz rules</DialogTitle>
            <DialogDescription>
              What this quiz is and how it works.
            </DialogDescription>
          </DialogHeader>
          {rulesContent}
        </DialogContent>
      </Dialog>

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
