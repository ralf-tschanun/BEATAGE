"use client";

import { useContestParticipantTabs } from "@/components/contest-participant-tabs";
import type { ContestParticipantTabId } from "@/components/contest-participant-tabs";
import { Button } from "@/components/ui/button";

type HostTabLinkPromptProps = {
  /** Shown when the host should take part as a participant. */
  show: boolean;
  tab: ContestParticipantTabId;
  /** Button / link label, e.g. "Voting". */
  tabLabel: string;
  children: string;
  /** Stronger CTA (used for Voting). */
  emphasized?: boolean;
};

/** Prompt with a link that switches contest tabs (Host Area → Nominate / Voting). */
export function HostTabLinkPrompt({
  show,
  tab,
  tabLabel,
  children,
  emphasized = false,
}: HostTabLinkPromptProps) {
  const tabs = useContestParticipantTabs();
  if (!show) return null;

  if (emphasized) {
    return (
      <div className="space-y-2 rounded-lg border-2 border-primary/40 bg-primary/5 px-3 py-3">
        <p className="text-sm font-medium text-foreground">{children}</p>
        <Button
          type="button"
          className="w-full sm:w-auto"
          onClick={() => tabs?.setActive(tab)}
        >
          Open {tabLabel}
        </Button>
      </div>
    );
  }

  return (
    <p className="rounded-lg border border-dashed px-3 py-2 text-sm">
      {children}{" "}
      <button
        type="button"
        className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
        onClick={() => tabs?.setActive(tab)}
      >
        {tabLabel}
      </button>
      .
    </p>
  );
}
