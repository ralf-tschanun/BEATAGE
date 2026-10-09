"use client";

import { useEffect, useMemo, useState } from "react";
import { loadCurrentBillingInterval } from "@/app/actions/billing-interval";
import { AccountAuthForm } from "@/components/account-auth-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QUIZ_PLANS, QUIZ_UNLOCK_LIMITS, type PlanId } from "@/lib/quiz-plans";
import {
  BILLING_SKU_LABELS,
  type BillingInterval,
  type BillingSku,
} from "@/lib/billing-copy";
import { goToBilling } from "@/lib/billing-nav";
import { cn } from "@/lib/utils";

type UnlockContestOption = {
  id: string;
  unlocked: boolean;
};

type ChangePlanFormProps = {
  currentPlan: PlanId;
  hasSession: boolean;
  isAnonymous?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
  /** Hosted contest that can be unlocked from this dialog. */
  unlockContest?: UnlockContestOption | null;
};

type Step = "closed" | "select" | "account";

function formatCap(value: number | null, singular: string, plural = `${singular}s`): string {
  if (value === null) return `unlimited ${plural}`;
  return `${value} ${value === 1 ? singular : plural}`;
}

/** Compact plan limits for the Your plan dialog (no mode labels). */
function planLimitHint(planId: PlanId): string {
  const plan = QUIZ_PLANS[planId];
  return [
    formatCap(plan.maxActiveQuizzes, "quiz"),
    formatCap(plan.maxCuratedTracks, "song"),
    formatCap(plan.maxMembers, "participant"),
    plan.inactivityExpiryDays === null
      ? "no expiry"
      : `${plan.inactivityExpiryDays}-day expiry`,
  ].join(" · ");
}

function currentPlanMark(interval: BillingInterval | null): string {
  if (interval === "monthly") return "Current · Monthly";
  if (interval === "yearly") return "Current · Yearly";
  return "Current";
}

function isCurrentBillingSku(
  sku: BillingSku,
  plan: PlanId,
  interval: BillingInterval | null,
): boolean {
  if (!interval || plan === "free") return false;
  return sku === `${plan}_${interval}`;
}

function checkoutHref(sku: BillingSku, quizId?: string): string {
  if (sku === "quiz_unlock" && quizId) {
    return `/api/billing/checkout?sku=${sku}&quizId=${encodeURIComponent(quizId)}`;
  }
  return `/api/billing/checkout?sku=${sku}`;
}

export function ChangePlanForm({
  currentPlan,
  hasSession,
  isAnonymous = false,
  open,
  onOpenChange,
  showTrigger = true,
  unlockContest = null,
}: ChangePlanFormProps) {
  const [step, setStep] = useState<Step>("closed");
  const [pendingSku, setPendingSku] = useState<BillingSku | null>(null);
  const [billingInterval, setBillingInterval] = useState<BillingInterval | null>(null);

  const paid = currentPlan === "plus" || currentPlan === "pro";

  useEffect(() => {
    if (currentPlan !== "plus" && currentPlan !== "pro") {
      setBillingInterval(null);
      return;
    }
    if (step !== "select") return;
    let cancelled = false;
    void loadCurrentBillingInterval().then((interval) => {
      if (!cancelled) setBillingInterval(interval);
    });
    return () => {
      cancelled = true;
    };
  }, [step, currentPlan]);

  useEffect(() => {
    if (open === undefined) return;
    if (open) {
      setStep(hasSession ? "select" : "closed");
      return;
    }
    setStep("closed");
  }, [open, hasSession]);

  function openSelect() {
    setStep("select");
  }

  function closeAll() {
    setStep("closed");
    setPendingSku(null);
    onOpenChange?.(false);
  }

  function backToSelect() {
    setPendingSku(null);
    setStep("select");
  }

  function startCheckout(sku: BillingSku) {
    if (isAnonymous) {
      setPendingSku(sku);
      setStep("account");
      return;
    }
    setPendingSku(sku);
    goToBilling(checkoutHref(sku, unlockContest?.id));
  }

  const planCards = useMemo(() => {
    function priceButton(sku: "plus_monthly" | "plus_yearly" | "pro_monthly" | "pro_yearly") {
      const current = isCurrentBillingSku(sku, currentPlan, billingInterval);
      return (
        <Button
          key={sku}
          type="button"
          size="sm"
          variant="outline"
          disabled={pendingSku !== null}
          aria-current={current ? "true" : undefined}
          className={cn(
            "w-full justify-between",
            current &&
              "cursor-default border-primary bg-primary/5 text-primary hover:bg-primary/5 hover:text-primary",
          )}
          onClick={() => {
            if (current) return;
            startCheckout(sku);
          }}
        >
          <span>{BILLING_SKU_LABELS[sku]}</span>
          {current ? (
            <span className="text-[11px] font-semibold tracking-wide uppercase">
              Current
            </span>
          ) : null}
        </Button>
      );
    }

    const subscriptionCards = (["free", "plus", "pro"] as PlanId[]).map((id) => {
      const selected = currentPlan === id;
      return (
        <div
          key={id}
          className={cn(
            "rounded-xl border p-3",
            selected ? "border-primary bg-primary/5" : "border-border",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{QUIZ_PLANS[id].label}</p>
            {selected ? (
              <span className="shrink-0 text-[11px] font-semibold tracking-wide whitespace-nowrap text-primary uppercase">
                {currentPlanMark(
                  id === "plus" || id === "pro" ? billingInterval : null,
                )}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{planLimitHint(id)}</p>
          {id === "plus" || id === "pro" ? (
            <div className="mt-3 flex flex-col gap-2">
              {priceButton(id === "plus" ? "plus_monthly" : "pro_monthly")}
              {priceButton(id === "plus" ? "plus_yearly" : "pro_yearly")}
            </div>
          ) : null}
        </div>
      );
    });

    const unlockCard = (
      <div key="unlock" className="rounded-xl border border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Unlock</p>
          {unlockContest?.unlocked ? (
            <span className="text-[11px] font-semibold tracking-wide text-primary uppercase">
              Unlocked
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          One quiz: up to {QUIZ_UNLOCK_LIMITS.maxCuratedTracks} songs and{" "}
          {QUIZ_UNLOCK_LIMITS.maxMembers} participants, Team Quiz, no inactivity
          expiry.
        </p>
        {unlockContest?.unlocked ? null : unlockContest?.id ? (
          <div className="mt-3 flex flex-col gap-2">
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={pendingSku !== null}
              onClick={() => startCheckout("quiz_unlock")}
            >
              {BILLING_SKU_LABELS.quiz_unlock}
            </Button>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Open an existing quiz to unlock it.
          </p>
        )}
      </div>
    );

    return [subscriptionCards[0], unlockCard, subscriptionCards[1], subscriptionCards[2]];
  }, [currentPlan, pendingSku, isAnonymous, unlockContest, billingInterval]);

  if (!hasSession && open === undefined && !showTrigger) {
    return null;
  }

  if (!hasSession) {
    const noSessionMessage = (
      <p className="text-sm text-muted-foreground">
        Create or join a quiz first to unlock plan changes for this device session.
      </p>
    );

    if (open !== undefined) {
      return (
        <Dialog
          open={open}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) onOpenChange?.(false);
          }}
        >
          <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Your plan</DialogTitle>
              <DialogDescription>
                Plan changes apply to this device session.
              </DialogDescription>
            </DialogHeader>
            {noSessionMessage}
            <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col sm:items-stretch">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange?.(false)}
              >
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );
    }

    return noSessionMessage;
  }

  return (
    <>
      {showTrigger ? (
        <Button type="button" variant="outline" onClick={openSelect}>
          Manage plan
        </Button>
      ) : null}

      <Dialog
        open={step === "select"}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeAll();
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto overscroll-contain sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Your plan</DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">{planCards}</div>

          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col sm:items-stretch">
            {paid ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => goToBilling("/api/billing/portal")}
              >
                Manage billing
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={closeAll}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={step === "account"}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) backToSelect();
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingSku === "quiz_unlock" ? "Unlock Quiz" : "Save your account first"}
            </DialogTitle>
            <DialogDescription>
              Checkout needs an email login. Create a new account on this
              device, or sign in — pending unlocks on this device move to your
              email account before payment.
            </DialogDescription>
          </DialogHeader>
          <AccountAuthForm
            hasSession={hasSession}
            isAnonymous={isAnonymous}
            preferSignup={isAnonymous}
            nextPath={
              pendingSku
                ? checkoutHref(pendingSku, unlockContest?.id)
                : undefined
            }
          />
          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col sm:items-stretch">
            <Button type="button" variant="ghost" onClick={backToSelect}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
