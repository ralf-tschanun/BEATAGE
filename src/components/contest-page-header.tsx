"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ScrollIcon, UserPlusIcon } from "@phosphor-icons/react";
import { ContestStatusBadges } from "@/components/contest-status-badges";
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

type ContestPageHeaderProps = {
  contestId: string;
  title: string;
  joinUrl: string;
  joinCode: string;
  defaultInviteOpen?: boolean;
  rulesContent: ReactNode;
  /**
   * When true, render chrome only (no sticky shell / tabs).
   * Used inside ContestParticipantTabs sticky wrapper.
   */
  embedded?: boolean;
  /** Sticky tab bar under the contest chrome (standalone mode only). */
  tabs?: ReactNode;
  initialStatus: string;
  initialNominationsOpen: boolean;
  initialVotingOpen: boolean;
  initialResultsPhase: string | null;
  initialResultsReveal?: string | null;
  initialResultsRevealStep?: number;
  initialNominatorRevealStep?: number;
  candidateSource?: string | null;
  nominationDurationSeconds?: number | null;
  candidateReveal?: string | null;
  initialNominationDeadline?: string | null;
  initialVotingClosesAt?: string | null;
  initialCandidates?: Array<{ id: string; status: string }>;
};

export function ContestPageHeader({
  contestId,
  title,
  joinUrl,
  joinCode,
  defaultInviteOpen = false,
  rulesContent,
  embedded = false,
  tabs,
  initialStatus,
  initialNominationsOpen,
  initialVotingOpen,
  initialResultsPhase,
  initialResultsReveal = null,
  initialResultsRevealStep = 0,
  initialNominatorRevealStep = 0,
  candidateSource = null,
  nominationDurationSeconds = null,
  candidateReveal = null,
  initialNominationDeadline = null,
  initialVotingClosesAt = null,
  initialCandidates = [],
}: ContestPageHeaderProps) {
  const [inviteOpen, setInviteOpen] = useState(defaultInviteOpen);
  const [rulesOpen, setRulesOpen] = useState(false);

  useEffect(() => {
    if (defaultInviteOpen) setInviteOpen(true);
  }, [defaultInviteOpen]);

  useEffect(() => {
    function onOpenInvite() {
      setInviteOpen(true);
    }
    window.addEventListener("contest:open-invite", onOpenInvite);
    return () => window.removeEventListener("contest:open-invite", onOpenInvite);
  }, []);

  const chrome = (
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
            aria-label="Contest rules"
            title="Contest rules"
          >
            <ScrollIcon />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            onClick={() => setInviteOpen(true)}
            aria-label="Invite participants"
            title="Invite"
          >
            <UserPlusIcon />
          </Button>
        </div>
      </div>

      <ContestStatusBadges
        contestId={contestId}
        initialStatus={initialStatus}
        initialNominationsOpen={initialNominationsOpen}
        initialVotingOpen={initialVotingOpen}
        initialResultsPhase={initialResultsPhase}
        initialResultsReveal={initialResultsReveal}
        initialResultsRevealStep={initialResultsRevealStep}
        initialNominatorRevealStep={initialNominatorRevealStep}
        candidateSource={candidateSource}
        nominationDurationSeconds={nominationDurationSeconds}
        candidateReveal={candidateReveal}
        initialNominationDeadline={initialNominationDeadline}
        initialVotingClosesAt={initialVotingClosesAt}
        initialCandidates={initialCandidates}
      />
    </>
  );

  return (
    <>
      {embedded ? (
        <div className="space-y-1">{chrome}</div>
      ) : (
        <header
          className={cn(
            "sticky top-14 z-40 -mx-6 border-b border-border/60 px-6 py-2",
            "bg-background/85 backdrop-blur-sm supports-[backdrop-filter]:bg-background/70",
          )}
        >
          <div className="space-y-1">
            {chrome}
            {tabs ? tabs : null}
          </div>
        </header>
      )}

      <Dialog open={rulesOpen} onOpenChange={setRulesOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Contest rules</DialogTitle>
            <DialogDescription>
              What this contest is and how it works.
            </DialogDescription>
          </DialogHeader>
          {rulesContent}
        </DialogContent>
      </Dialog>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite participants</DialogTitle>
            <DialogDescription>
              Share the link or join code so others can enter this contest.
            </DialogDescription>
          </DialogHeader>
          <InviteShare
            joinUrl={joinUrl}
            joinCode={joinCode}
            contestTitle={title}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
