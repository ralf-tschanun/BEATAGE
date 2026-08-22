"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChangePlanForm } from "@/components/change-plan-form";
import type { PlanId } from "@/lib/plans";

const LINK_CLASS =
  "font-medium text-foreground underline underline-offset-2 hover:text-primary";

type ContestCreatedBannerProps = {
  contestId: string;
  maxMembers: number | null;
  planId: PlanId;
  planLabel: string;
  hasSession: boolean;
  isAnonymous: boolean;
  /** When true, show participant-cap + unlock/upgrade hint. */
  showParticipantLimitHint: boolean;
};

/** Success copy after create — Invite / Host Area / Unlock / upgrade are actionable. */
export function ContestCreatedBanner({
  contestId,
  maxMembers,
  planId,
  planLabel,
  hasSession,
  isAnonymous,
  showParticipantLimitHint,
}: ContestCreatedBannerProps) {
  const router = useRouter();
  const [planOpen, setPlanOpen] = useState(false);

  function openInvite() {
    window.dispatchEvent(new Event("contest:open-invite"));
  }

  function openHostArea() {
    const next = "host";
    if (window.location.hash === `#${next}`) {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } else {
      window.location.hash = next;
    }
  }

  const planBadge = (
    <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 font-semibold text-foreground ring-1 ring-inset ring-primary/25">
      {planLabel} plan
    </span>
  );

  return (
    <>
      <p className="text-sm text-foreground">
        Contest created. Use{" "}
        <button type="button" className={LINK_CLASS} onClick={openInvite}>
          Invite
        </button>{" "}
        to share - use{" "}
        <button type="button" className={LINK_CLASS} onClick={openHostArea}>
          Host Area
        </button>{" "}
        to manage this contest.
        {showParticipantLimitHint && maxMembers != null && maxMembers >= 1 ? (
          <>
            {" "}
            You can invite up to {maxMembers} participants on {planBadge}. Need
            more?{" "}
            <button
              type="button"
              className={LINK_CLASS}
              onClick={() =>
                router.push(
                  `/api/billing/checkout?sku=quiz_unlock&contestId=${encodeURIComponent(contestId)}`,
                )
              }
            >
              Unlock
            </button>{" "}
            this contest or{" "}
            <button
              type="button"
              className={LINK_CLASS}
              onClick={() => setPlanOpen(true)}
            >
              upgrade
            </button>
            .
          </>
        ) : null}
      </p>

      <ChangePlanForm
        currentPlan={planId}
        hasSession={hasSession}
        isAnonymous={isAnonymous}
        open={planOpen}
        onOpenChange={setPlanOpen}
        showTrigger={false}
        unlockContest={{ id: contestId, unlocked: false }}
      />
    </>
  );
}
