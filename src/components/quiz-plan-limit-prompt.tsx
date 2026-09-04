"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  finishQuizAction,
  type QuizRoundActionState,
} from "@/app/actions/quiz-round";
import { ChangePlanForm } from "@/components/change-plan-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { BILLING_SKU_LABELS } from "@/lib/billing-copy";
import { goToBilling } from "@/lib/billing-nav";
import {
  parseQuizPlanLimitError,
  type QuizPlanLimitKind,
} from "@/lib/quiz-plan-limits";
import { QUIZ_UNLOCK_LIMITS, type PlanId } from "@/lib/quiz-plans";
import { cn } from "@/lib/utils";

type QuizPlanLimitPromptProps = {
  quizId: string;
  joinCode: string;
  /** Raw server error or short reason text. */
  message?: string | null;
  kind?: QuizPlanLimitKind;
  cap?: number | null;
  planId?: PlanId;
  isAnonymous?: boolean;
  unlocked?: boolean;
  className?: string;
  /** Hide the finish-quiz button (e.g. already finishing elsewhere). */
  hideFinish?: boolean;
};

const initialFinish: QuizRoundActionState = null;

function titleFor(kind: QuizPlanLimitKind, cap: number | null): string {
  if (kind === "participants") {
    return cap != null
      ? `Participant limit reached (${cap})`
      : "Participant limit reached";
  }
  if (kind === "songs") {
    return cap != null ? `Song limit reached (${cap})` : "Song limit reached";
  }
  return cap != null ? `Round limit reached (${cap})` : "Round limit reached";
}

function bodyFor(kind: QuizPlanLimitKind, cap: number | null): string {
  if (kind === "participants") {
    return cap != null
      ? `This quiz is full (${cap} players on the current plan). Unlock this quiz, change your plan, or finish the quiz.`
      : "This quiz is full. Unlock this quiz, change your plan, or finish the quiz.";
  }
  if (kind === "songs") {
    return cap != null
      ? `Your plan allows ${cap} songs on this quiz. Unlock once, change your plan, or finish the quiz.`
      : "Your plan song limit is reached. Unlock once, change your plan, or finish the quiz.";
  }
  return cap != null
    ? `Your plan allows ${cap} rounds on this quiz. To keep playing, unlock this event, change your plan, or finish the quiz.`
    : "Your plan round limit is reached. Unlock this event, change your plan, or finish the quiz.";
}

function maxSelfServeCapFor(kind: QuizPlanLimitKind): number {
  return kind === "participants"
    ? QUIZ_UNLOCK_LIMITS.maxMembers
    : QUIZ_UNLOCK_LIMITS.maxCuratedTracks;
}

/**
 * Host prompt when rounds / songs / participants hit the plan cap:
 * unlock, change plan, or finish the quiz.
 */
export function QuizPlanLimitPrompt({
  quizId,
  joinCode,
  message = null,
  kind: kindProp,
  cap: capProp = null,
  planId = "free",
  isAnonymous = false,
  unlocked = false,
  className,
  hideFinish = false,
}: QuizPlanLimitPromptProps) {
  const router = useRouter();
  const [planOpen, setPlanOpen] = useState(false);
  const [finishState, finishAction, finishPending] = useActionState(
    finishQuizAction,
    initialFinish,
  );

  const parsed = parseQuizPlanLimitError(message);
  const kind = kindProp ?? parsed?.kind ?? "rounds";
  const cap = capProp ?? parsed?.cap ?? null;
  const atSelfServeMax =
    planId === "pro" || unlocked || (cap != null && cap >= maxSelfServeCapFor(kind));

  const unlockCheckoutPath = `/api/billing/checkout?sku=quiz_unlock&quizId=${encodeURIComponent(quizId)}`;
  const unlockHref = isAnonymous
    ? `/billing/account?next=${encodeURIComponent(unlockCheckoutPath)}`
    : unlockCheckoutPath;

  useEffect(() => {
    if (!finishState?.ok) return;
    router.refresh();
  }, [finishState?.ok, router]);

  if (unlocked && kind !== "participants") {
    return null;
  }

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3",
        className,
      )}
      role="status"
    >
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {titleFor(kind, cap)}
        </p>
        <p className="text-sm text-muted-foreground">
          {atSelfServeMax
            ? "This quiz is already at the highest self-service limit. Please contact us if you need more."
            : bodyFor(kind, cap)}
        </p>
        {atSelfServeMax ? (
          <p className="text-xs text-muted-foreground">
            Pro and Quiz Unlock both allow up to {maxSelfServeCapFor(kind)}{" "}
            {kind === "participants" ? "participants" : "songs / rounds"}.
          </p>
        ) : kind !== "participants" ? (
          <p className="text-xs text-muted-foreground">
            Unlock raises this quiz to {QUIZ_UNLOCK_LIMITS.maxCuratedTracks}{" "}
            songs / rounds and {QUIZ_UNLOCK_LIMITS.maxMembers} participants, with
            no inactivity expiry.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Unlock raises the participant cap to {QUIZ_UNLOCK_LIMITS.maxMembers}{" "}
            for this quiz.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {atSelfServeMax ? (
          <Link href="/contact" className={buttonVariants({ size: "sm" })}>
            Contact us
          </Link>
        ) : !unlocked ? (
          <Button
            type="button"
            size="sm"
            onClick={() => goToBilling(unlockHref)}
          >
            Unlock this quiz ({BILLING_SKU_LABELS.quiz_unlock})
          </Button>
        ) : null}
        {!atSelfServeMax ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setPlanOpen(true)}
        >
          Change plan
        </Button>
        ) : null}
        {!hideFinish ? (
          <form action={finishAction}>
            <input type="hidden" name="quizId" value={quizId} />
            <input type="hidden" name="joinCode" value={joinCode} />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={finishPending}
            >
              {finishPending ? "Finishing…" : "Finish quiz"}
            </Button>
          </form>
        ) : null}
      </div>

      {finishState?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {finishState.error}
        </p>
      ) : null}

      <ChangePlanForm
        currentPlan={planId}
        hasSession
        isAnonymous={isAnonymous}
        open={planOpen}
        onOpenChange={setPlanOpen}
        showTrigger={false}
        unlockContest={{ id: quizId, unlocked }}
      />
    </div>
  );
}
