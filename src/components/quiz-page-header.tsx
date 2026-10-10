"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ClipboardTextIcon, UsersIcon } from "@phosphor-icons/react";
import { InviteShare } from "@/components/invite-share";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type QuizPageHeaderProps = {
  title: string;
  joinCode: string;
  joinUrl: string;
  /** Open invite dialog on mount (e.g. after create). */
  openInviteOnMount?: boolean;
  rulesContent: ReactNode;
  /** Status badges under the title — stay sticky with the chrome. */
  statusBadges?: ReactNode;
};

export function QuizPageHeader({
  title,
  joinCode,
  joinUrl,
  openInviteOnMount = false,
  rulesContent,
  statusBadges,
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
      <header
        className={cn(
          "sticky top-14 z-40 -mx-6 border-b border-border/60 px-6 py-2",
          "bg-background/85 backdrop-blur-sm supports-[backdrop-filter]:bg-background/70",
        )}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="min-w-0 flex-1 truncate text-lg font-semibold leading-tight tracking-tight">
              {title}
            </h1>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() => setRulesOpen(true)}
                aria-label="Quiz rules"
                title="Quiz rules"
              >
                <ClipboardTextIcon className="size-5" weight="bold" aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() => setInviteOpen(true)}
                aria-label="Invite players"
                title="Invite"
              >
                <UsersIcon className="size-5" weight="bold" aria-hidden />
              </Button>
            </div>
          </div>
          {statusBadges}
        </div>
      </header>

      <Dialog open={rulesOpen} onOpenChange={setRulesOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardTextIcon className="size-5 shrink-0" weight="bold" aria-hidden />
              Quiz rules
            </DialogTitle>
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
