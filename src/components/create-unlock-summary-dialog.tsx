"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChangePlanForm } from "@/components/change-plan-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BILLING_SKU_LABELS } from "@/lib/billing-copy";
import type { PlanLimitOverageSummary } from "@/lib/contest-unlock";
import type { PlanId } from "@/lib/plans";

type CreateUnlockSummaryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: PlanLimitOverageSummary;
  showPlusUpgrade: boolean;
  showProUpgrade: boolean;
  onCreateWithinPlan: () => void;
  onUnlockAndCreate: () => void;
  pending?: boolean;
  error?: string | null;
};

export function CreateUnlockSummaryDialog({
  open,
  onOpenChange,
  summary,
  showPlusUpgrade,
  showProUpgrade,
  onCreateWithinPlan,
  onUnlockAndCreate,
  pending = false,
  error = null,
}: CreateUnlockSummaryDialogProps) {
  const router = useRouter();

  const lines: string[] = [];
  if (summary.nominationsPerParticipant && summary.nominationPlanMax != null) {
    lines.push(
      `${summary.nominationCount} nominations per participant (your plan: ${summary.nominationPlanMax})`,
    );
  }
  if (summary.curatedCandidates && summary.curatedPlanMax != null) {
    lines.push(
      `${summary.curatedCount} curated candidates (your plan: ${summary.curatedPlanMax})`,
    );
  }
  if (summary.participantPlanMax != null) {
    lines.push(
      `Up to ${summary.participantPlanMax} participants on your plan (unlock: unlimited)`,
    );
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
          <DialogTitle>Unlock this contest to create</DialogTitle>
          <DialogDescription>
            Your setup goes beyond your current plan. Unlock once for unlimited
            participants and no expiry on this contest — your nomination and
            candidate counts from setup stay as you configured them — or go back
            and reduce.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 text-sm text-muted-foreground">
          {lines.map((line) => (
            <li key={line} className="rounded-lg border border-border px-3 py-2">
              {line}
            </li>
          ))}
        </ul>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
          <Button type="button" disabled={pending} onClick={onUnlockAndCreate}>
            {pending
              ? "Creating…"
              : `Unlock & create (${BILLING_SKU_LABELS.quiz_unlock})`}
          </Button>
          {showPlusUpgrade ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/api/billing/checkout?sku=plus_monthly")}
            >
              Upgrade to Plus ({BILLING_SKU_LABELS.plus_monthly})
            </Button>
          ) : null}
          {showProUpgrade ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/api/billing/checkout?sku=pro_monthly")}
            >
              Upgrade to Pro ({BILLING_SKU_LABELS.pro_monthly})
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={onCreateWithinPlan}
          >
            Go back and reduce
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type OverPlanPendingAction = {
  apply: () => void;
  revert: () => void;
};

type OverPlanWarningDialogProps = {
  open: boolean;
  onContinue: () => void;
  onCancel: () => void;
  includesPhotos: boolean;
};

export function OverPlanWarningDialog({
  open,
  onContinue,
  onCancel,
  includesPhotos,
}: OverPlanWarningDialogProps) {
  return (
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={(next) => {
        if (next) return;
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Above your plan limits</DialogTitle>
          <DialogDescription>
            You can keep setting up this contest above your plan limits. To create
            it, you will need a one-time contest unlock at the end — or reduce back
            to your plan limits. Unlock keeps the nomination and candidate counts
            you configure; it adds unlimited participants and no expiry.
            {includesPhotos
              ? " Photo files are not saved in the draft; after you unlock, add photos again in the contest."
              : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
          <Button type="button" onClick={onContinue}>
            Continue setup
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const OVER_PLAN_WARNING_ACK_KEY = "beatage.over_plan_warning_ack";
/** Separate from curated-candidate ack so nominations still warn after “Continue setup”. */
export const OVER_PLAN_NOMINATIONS_ACK_KEY =
  "beatage.over_plan_nominations_ack";

export type OverPlanWarningKind = "curated" | "nominations";

export function overPlanAckStorageKey(kind: OverPlanWarningKind): string {
  return kind === "nominations"
    ? OVER_PLAN_NOMINATIONS_ACK_KEY
    : OVER_PLAN_WARNING_ACK_KEY;
}

type CreateParticipantLimitDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maxMembers: number;
  planLabel: string;
  planId: PlanId;
  hasSession: boolean;
  isAnonymous?: boolean;
  pending?: boolean;
  onCreateWithPlanLimit: () => void;
  onUnlockAndCreate: () => void;
};

/** Shown on Create when the account plan caps participants (Free/Plus). */
export function CreateParticipantLimitDialog({
  open,
  onOpenChange,
  maxMembers,
  planLabel,
  planId,
  hasSession,
  isAnonymous = false,
  pending = false,
  onCreateWithPlanLimit,
  onUnlockAndCreate,
}: CreateParticipantLimitDialogProps) {
  const [planOpen, setPlanOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center sm:text-center">
          <DialogTitle>Participant limit on {planLabel}</DialogTitle>
          <DialogDescription className="text-center">
            You can invite up to {maxMembers} participants on {planLabel}. Need
            more?{" "}
            <button
              type="button"
              className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
              disabled={pending}
              onClick={onUnlockAndCreate}
            >
              Unlock
            </button>{" "}
            this contest for unlimited participants, or{" "}
            <button
              type="button"
              className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
              disabled={pending}
              onClick={() => setPlanOpen(true)}
            >
              upgrade your plan
            </button>
            .
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col sm:items-stretch">
          <Button
            type="button"
            disabled={pending}
            onClick={onCreateWithPlanLimit}
          >
            {pending
              ? "Creating…"
              : `Create with max. ${maxMembers} participants`}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </DialogFooter>

        <ChangePlanForm
          currentPlan={planId}
          hasSession={hasSession}
          isAnonymous={isAnonymous}
          open={planOpen}
          onOpenChange={setPlanOpen}
          showTrigger={false}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Which plan upgrade CTAs to show in the unlock summary for this wizard setup. */
export function unlockSummaryUpgradeOptions(
  planId: PlanId,
  fitsPlus: boolean,
  fitsPro: boolean,
): { showPlusUpgrade: boolean; showProUpgrade: boolean } {
  const showPlusUpgrade = planId === "free" && fitsPlus;
  const showProUpgrade =
    planId !== "pro" && (!fitsPlus || planId === "plus") && fitsPro;
  return { showPlusUpgrade, showProUpgrade };
}
