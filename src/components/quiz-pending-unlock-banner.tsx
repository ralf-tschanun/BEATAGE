"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  continueQuizWithPlanAction,
  type QuizActionState,
} from "@/app/actions/quiz";
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
import { goToBilling } from "@/lib/billing-nav";
import {
  getQuizPlanLimits,
  type PlanId,
} from "@/lib/quiz-plans";
import { cn } from "@/lib/utils";

type QuizPendingUnlockBannerProps = {
  quizId: string;
  joinCode: string;
  planId: PlanId;
  trackCount: number;
  /** True when the host has a free active quiz slot again. */
  canContinueWithPlan: boolean;
  isAnonymous?: boolean;
  /**
   * On /billing/account the auth form already continues to Polar checkout —
   * hide the Complete unlock link to avoid a loop.
   */
  hideUnlockLink?: boolean;
  className?: string;
};

const initialState: QuizActionState = null;

function formatPlanLimits(planId: PlanId): string {
  const plan = getQuizPlanLimits(planId);
  const songs =
    plan.maxCuratedTracks == null
      ? "unlimited songs"
      : `${plan.maxCuratedTracks} songs`;
  const participants =
    plan.maxMembers == null
      ? "unlimited participants"
      : `${plan.maxMembers} participants`;
  const expiry =
    plan.inactivityExpiryDays == null
      ? "no inactivity expiry"
      : `${plan.inactivityExpiryDays}-day inactivity expiry`;
  return `${songs}, ${participants}, ${expiry}`;
}

/**
 * Host banner for payment_pending quizzes: complete paid unlock, or — when a
 * plan slot is free again — continue under Free/Plus/Pro limits instead.
 */
export function QuizPendingUnlockBanner({
  quizId,
  joinCode,
  planId,
  trackCount,
  canContinueWithPlan,
  isAnonymous = false,
  hideUnlockLink = false,
  className,
}: QuizPendingUnlockBannerProps) {
  const router = useRouter();
  const plan = getQuizPlanLimits(planId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    continueQuizWithPlanAction,
    initialState,
  );

  const songCap = plan.maxCuratedTracks;
  const overSongs = songCap != null && trackCount > songCap;
  const unlockCheckoutPath = `/api/billing/checkout?sku=quiz_unlock&quizId=${encodeURIComponent(quizId)}`;
  const unlockHref = isAnonymous
    ? `/billing/account?next=${encodeURIComponent(unlockCheckoutPath)}`
    : unlockCheckoutPath;

  useEffect(() => {
    if (!state?.success) return;
    setConfirmOpen(false);
    if (state.redirectTo) {
      router.push(state.redirectTo);
    }
    router.refresh();
  }, [state?.success, state?.redirectTo, router]);

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 pt-4",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-foreground">
          This quiz is waiting for unlock payment before players can join.
          {canContinueWithPlan
            ? " You have a free active quiz slot again — continue on your plan or unlock."
            : null}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {canContinueWithPlan ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen(true)}
            >
              Continue with {plan.label} plan
            </Button>
          ) : null}
          {hideUnlockLink ? (
            canContinueWithPlan ? (
              <span className="text-sm text-muted-foreground">
                Or sign in below to unlock
              </span>
            ) : null
          ) : (
            <a
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              href={unlockHref}
            >
              Complete unlock
            </a>
          )}
        </div>
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (pending && !open) return;
          setConfirmOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>Continue with {plan.label}?</DialogTitle>
            <DialogDescription>
              Your {plan.label} plan allows {formatPlanLimits(planId)}. This quiz
              will use those limits (not unlock caps). Need more songs or
              participants? Unlock once or{" "}
              <button
                type="button"
                className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
                onClick={() => setPlanOpen(true)}
              >
                change your plan
              </button>
              .
            </DialogDescription>
          </DialogHeader>

          {overSongs ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              This quiz has {trackCount} songs; {plan.label} allows {songCap}.
              Remove songs first, unlock (
              {BILLING_SKU_LABELS.quiz_unlock}), or change your plan.
            </p>
          ) : (
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="rounded-lg border border-border px-3 py-2">
                Up to {songCap ?? "unlimited"} songs
                {trackCount > 0 ? ` (currently ${trackCount})` : ""}
              </li>
              <li className="rounded-lg border border-border px-3 py-2">
                Up to {plan.maxMembers ?? "unlimited"} participants
              </li>
              <li className="rounded-lg border border-border px-3 py-2">
                {plan.inactivityExpiryDays == null
                  ? "No inactivity expiry"
                  : `${plan.inactivityExpiryDays}-day inactivity expiry`}
              </li>
            </ul>
          )}

          {state?.error ? (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}

          <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
            {overSongs ? (
              <Button type="button" onClick={() => goToBilling(unlockHref)}>
                Unlock instead ({BILLING_SKU_LABELS.quiz_unlock})
              </Button>
            ) : (
              <form action={formAction}>
                <input type="hidden" name="quizId" value={quizId} />
                <input type="hidden" name="joinCode" value={joinCode} />
                <Button type="submit" className="w-full" disabled={pending}>
                  {pending
                    ? "Opening…"
                    : `Continue with ${plan.label}`}
                </Button>
              </form>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChangePlanForm
        currentPlan={planId}
        hasSession
        isAnonymous={isAnonymous}
        open={planOpen}
        onOpenChange={setPlanOpen}
        showTrigger={false}
        unlockContest={{ id: quizId, unlocked: false }}
      />
    </div>
  );
}
