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
import type { PlanId } from "@/lib/quiz-plans";
import { getQuizPlanLimits } from "@/lib/quiz-plans";

type CreateQuizSlotLimitTipDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planId: PlanId;
  planLabel: string;
  hasSession: boolean;
  isAnonymous?: boolean;
  /** Acknowledge tip and enter the create wizard. */
  onContinue: () => void;
  /** Leave create without starting the wizard. */
  onCancel: () => void;
};

/**
 * Shown before the create wizard when the active-quiz slot is full.
 * User can still continue setup; unlock or a plan change is required at create.
 */
export function CreateQuizSlotLimitTipDialog({
  open,
  onOpenChange,
  planId,
  planLabel,
  hasSession,
  isAnonymous = false,
  onContinue,
  onCancel,
}: CreateQuizSlotLimitTipDialogProps) {
  const [planOpen, setPlanOpen] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          onOpenChange(true);
          return;
        }
        // Ignore outside / escape while the plan picker is open; Cancel uses onCancel.
        if (planOpen) return;
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Active quiz limit on {planLabel}</DialogTitle>
          <DialogDescription>
            Your plan has no free active quiz slot left. You can still set up a new
            quiz — at the end you will need a one-time unlock (
            {BILLING_SKU_LABELS.quiz_unlock}) to create it, or{" "}
            <button
              type="button"
              className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
              onClick={() => setPlanOpen(true)}
            >
              change your plan
            </button>{" "}
            for more active quizzes. Cancel now if you prefer not to enter the
            details yet.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
          <Button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onContinue();
            }}
          >
            Continue setup
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              onCancel();
            }}
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

type CreateQuizUnlockDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planId: PlanId;
  activeHostedCount: number;
  onUnlockAndCreate: () => void;
  pending?: boolean;
  error?: string | null;
  /** Why unlock is required — drives title/copy. */
  reason?: "slot" | "songs" | "both";
};

/**
 * Shown when Free/Plus active-quiz limit is reached, or the playlist exceeds the
 * free song cap — unlock once lifts slot / song / member / expiry caps for this quiz.
 */
export function CreateQuizUnlockDialog({
  open,
  onOpenChange,
  planId,
  activeHostedCount,
  onUnlockAndCreate,
  pending = false,
  error = null,
  reason = "slot",
}: CreateQuizUnlockDialogProps) {
  const router = useRouter();
  const plan = getQuizPlanLimits(planId);
  const showPlus = planId === "free";
  const showPro = planId === "free" || planId === "plus";
  const forSongs = reason === "songs" || reason === "both";
  const forSlot = reason === "slot" || reason === "both";

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
          <DialogTitle>
            {forSongs && !forSlot
              ? "Unlock for unlimited songs"
              : "Unlock this quiz to create"}
          </DialogTitle>
          <DialogDescription>
            {forSlot ? (
              <>
                Your {plan.label} plan allows{" "}
                {plan.maxActiveQuizzes == null
                  ? "unlimited"
                  : plan.maxActiveQuizzes}{" "}
                active quiz{plan.maxActiveQuizzes === 1 ? "" : "zes"}
                {plan.maxActiveQuizzes != null
                  ? ` (${activeHostedCount} in use)`
                  : ""}
                .
              </>
            ) : null}
            {forSongs ? (
              <>
                {forSlot ? " " : null}
                Your plan includes up to {plan.maxCuratedTracks ?? 10} songs per
                quiz — unlock this quiz once for an unlimited playlist.
              </>
            ) : null}{" "}
            Unlock also removes the participant cap and inactivity expiry, and this
            quiz does not count toward your active quiz limit.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="rounded-lg border border-border px-3 py-2">
            Unlimited songs on this quiz
          </li>
          <li className="rounded-lg border border-border px-3 py-2">
            Unlimited participants on this quiz
          </li>
          <li className="rounded-lg border border-border px-3 py-2">
            No inactivity expiry on this quiz
          </li>
          <li className="rounded-lg border border-border px-3 py-2">
            Does not count toward your active quiz limit
          </li>
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
          {showPlus ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                router.push("/api/billing/checkout?sku=plus_monthly")
              }
            >
              Upgrade to Plus ({BILLING_SKU_LABELS.plus_monthly})
            </Button>
          ) : null}
          {showPro ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                router.push("/api/billing/checkout?sku=pro_monthly")
              }
            >
              Upgrade to Pro ({BILLING_SKU_LABELS.pro_monthly})
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
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
