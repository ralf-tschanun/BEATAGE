"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ChangePlanForm } from "@/components/change-plan-form";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BILLING_SKU_LABELS } from "@/lib/billing-copy";
import { goToBilling } from "@/lib/billing-nav";
import type { PlanId } from "@/lib/quiz-plans";
import {
  getQuizPlanLimits,
  planAllowsQuizTeams,
  QUIZ_UNLOCK_LIMITS,
} from "@/lib/quiz-plans";

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
  const isMaxPlan = planId === "pro";

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
            {isMaxPlan ? (
              <>
                Your Pro plan has no free active quiz slot left. Please{" "}
                <Link
                  href="/contact"
                  className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
                >
                  contact us
                </Link>{" "}
                if you need more.
              </>
            ) : (
              <>
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
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
          {isMaxPlan ? (
            <Link href="/contact" className={buttonVariants()}>
              Contact us
            </Link>
          ) : (
            <Button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onContinue();
              }}
            >
              Continue setup
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
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
  reason?: "slot" | "songs" | "teams" | "both";
  /** Team mode on Free also requires the one-time quiz unlock. */
  teamsRequired?: boolean;
};

/**
 * Shown when Free/Plus active-quiz limit is reached, or the playlist exceeds the
 * plan song cap — unlock once raises slot / song / member / expiry caps for this quiz.
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
  teamsRequired = false,
}: CreateQuizUnlockDialogProps) {
  const plan = getQuizPlanLimits(planId);
  const showPlus = planId === "free";
  const showPro = planId === "free" || planId === "plus";
  const forSongs = reason === "songs" || reason === "both";
  const forSlot = reason === "slot" || reason === "both";
  const forTeams =
    (reason === "teams" || teamsRequired) && !planAllowsQuizTeams(planId);
  const canSelfServeUnlock = planId !== "pro";

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
            {!canSelfServeUnlock
              ? "Please contact us"
              : forTeams && !forSongs && !forSlot
              ? "Unlock Team mode"
              : forSongs && !forSlot
              ? `Unlock for up to ${QUIZ_UNLOCK_LIMITS.maxCuratedTracks} songs`
              : "Unlock this quiz to create"}
          </DialogTitle>
          <DialogDescription>
            {!canSelfServeUnlock ? (
              <>
                Your Pro plan is already at the highest self-service limit.
                Please{" "}
                <Link
                  href="/contact"
                  className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
                >
                  contact us
                </Link>{" "}
                if you need more.
              </>
            ) : (
              <>
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
                quiz — unlock this quiz once for up to{" "}
                {QUIZ_UNLOCK_LIMITS.maxCuratedTracks} songs and{" "}
                {QUIZ_UNLOCK_LIMITS.maxMembers} participants.
              </>
            ) : null}
            {forTeams ? (
              <>
                {forSlot || forSongs ? " " : null}
                Team mode is included with Plus, Pro, or a one-time Quiz Unlock.
              </>
            ) : null}{" "}
            Unlock also removes inactivity expiry, and this quiz does not count
            toward your active quiz limit.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {canSelfServeUnlock ? (
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="rounded-lg border border-border px-3 py-2">
            Up to {QUIZ_UNLOCK_LIMITS.maxCuratedTracks} songs on this quiz
          </li>
          <li className="rounded-lg border border-border px-3 py-2">
            Up to {QUIZ_UNLOCK_LIMITS.maxMembers} participants on this quiz
          </li>
          <li className="rounded-lg border border-border px-3 py-2">
            Team mode on this quiz
          </li>
          <li className="rounded-lg border border-border px-3 py-2">
            No inactivity expiry on this quiz
          </li>
          <li className="rounded-lg border border-border px-3 py-2">
            Does not count toward your active quiz limit
          </li>
        </ul>
        ) : null}

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
          {canSelfServeUnlock ? (
            <Button type="button" disabled={pending} onClick={onUnlockAndCreate}>
              {pending
                ? "Creating…"
                : `Unlock & create (${BILLING_SKU_LABELS.quiz_unlock})`}
            </Button>
          ) : (
            <Link href="/contact" className={buttonVariants()}>
              Contact us
            </Link>
          )}
          {canSelfServeUnlock && showPlus ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                goToBilling("/api/billing/checkout?sku=plus_monthly")
              }
            >
              Upgrade to Plus ({BILLING_SKU_LABELS.plus_monthly})
            </Button>
          ) : null}
          {canSelfServeUnlock && showPro ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                goToBilling("/api/billing/checkout?sku=pro_monthly")
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

type CreateQuizParticipantLimitDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maxMembers: number;
  planLabel: string;
  planId: PlanId;
  hasSession: boolean;
  isAnonymous?: boolean;
  pending?: boolean;
  /** Compact summary of the quiz options about to be created. */
  settingsSummary?: string | null;
  onCreateWithPlanLimit: () => void;
  onUnlockAndCreate: () => void;
};

/** Shown on Create when the account plan caps participants (Free/Plus/Pro). */
export function CreateQuizParticipantLimitDialog({
  open,
  onOpenChange,
  maxMembers,
  planLabel,
  planId,
  hasSession,
  isAnonymous = false,
  pending = false,
  settingsSummary = null,
  onCreateWithPlanLimit,
  onUnlockAndCreate,
}: CreateQuizParticipantLimitDialogProps) {
  const [planOpen, setPlanOpen] = useState(false);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const summary = settingsSummary?.trim() || null;
  const canIncreaseParticipantLimit =
    planId !== "pro" && maxMembers < QUIZ_UNLOCK_LIMITS.maxMembers;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        initialFocus={createButtonRef}
      >
        <DialogHeader className="text-center sm:text-center">
          <DialogTitle>Participant limit on {planLabel}</DialogTitle>
          <DialogDescription className="text-center">
            {canIncreaseParticipantLimit ? (
              <>
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
                this quiz for up to {QUIZ_UNLOCK_LIMITS.maxMembers} participants, or{" "}
                <button
                  type="button"
                  className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
                  disabled={pending}
                  onClick={() => setPlanOpen(true)}
                >
                  upgrade your plan
                </button>
                .
              </>
            ) : (
              <>
                You can invite up to {maxMembers} participants on {planLabel}. Need
                more? Please{" "}
                <Link
                  href="/contact"
                  className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
                >
                  contact us
                </Link>
                .
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col sm:items-stretch">
          <Button
            ref={createButtonRef}
            type="button"
            disabled={pending}
            onClick={onCreateWithPlanLimit}
          >
            {pending
              ? "Creating…"
              : `Create with max. ${maxMembers} participants`}
          </Button>
          {summary ? (
            <p
              className="max-h-24 overflow-y-auto text-left text-xs leading-relaxed text-muted-foreground"
              tabIndex={-1}
            >
              Quiz setting: {summary}
            </p>
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
