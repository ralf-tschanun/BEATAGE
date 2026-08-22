"use client";

import { useState } from "react";
import Link from "next/link";
import { PlusCircleIcon, TicketIcon } from "@phosphor-icons/react";
import { ChangePlanForm } from "@/components/change-plan-form";
import { buttonVariants } from "@/components/ui/button";
import { BRAND_NAME } from "@/lib/brand";
import type { PlanId } from "@/lib/quiz-plans";
import { cn } from "@/lib/utils";

type HomeHeroProps = {
  canCreate: boolean;
  planId: PlanId;
  planLabel: string;
  maxActiveQuizzes: number | null;
  activeHostedCount: number;
  hasSession: boolean;
  isAnonymous: boolean;
};

export function HomeHero({
  canCreate,
  planId,
  planLabel,
  maxActiveQuizzes,
  activeHostedCount,
  hasSession,
  isAnonymous,
}: HomeHeroProps) {
  const [planOpen, setPlanOpen] = useState(false);
  const remaining =
    maxActiveQuizzes === null
      ? null
      : Math.max(0, maxActiveQuizzes - activeHostedCount);
  const atLimit = maxActiveQuizzes !== null && remaining === 0;
  const planBadge = (
    <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 font-semibold text-foreground ring-1 ring-inset ring-primary/25">
      {planLabel} plan
    </span>
  );

  return (
    <section className="relative px-6 py-16 sm:py-20 lg:py-24">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-primary/5 to-transparent" />
      <div className="relative mx-auto max-w-3xl space-y-8 text-center">
        <div className="mx-auto max-w-xl space-y-4">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
            Guess the release year.
          </h1>
          <p className="text-xl font-medium tracking-tight text-foreground/90 sm:text-2xl">
            {BRAND_NAME} — music quiz nights with friends.
          </p>
          <p className="text-lg leading-relaxed text-muted-foreground">
            The host plays a hit on Spotify. Everyone guesses the release year — plus
            chart facts when you want extra scoring.
          </p>
        </div>

        <div className="mx-auto w-full max-w-xl space-y-3 min-[440px]:max-w-2xl">
          <div className="grid w-full grid-cols-1 gap-3 min-[440px]:grid-cols-2">
            <Link
              href={canCreate ? "/create" : "/#hosted"}
              className={cn(
                buttonVariants({ size: "lg" }),
                "h-auto min-h-14 w-full justify-center gap-2 px-5 py-4 text-base",
                !canCreate && "pointer-events-none opacity-60",
              )}
              aria-disabled={!canCreate}
            >
              <PlusCircleIcon className="size-5 shrink-0" weight="bold" />
              Create a quiz
            </Link>
            <Link
              href="/join"
              className={cn(
                buttonVariants({ variant: "secondary", size: "lg" }),
                "h-auto min-h-14 w-full justify-center gap-2 px-5 py-4 text-base",
              )}
            >
              <TicketIcon className="size-5 shrink-0" weight="bold" />
              I have an invite
            </Link>
          </div>

          {atLimit ? (
            <p className="text-sm text-muted-foreground">
              Active quiz limit reached on your {planBadge} plan. Finish a quiz or{" "}
              <button
                type="button"
                className="font-medium text-foreground underline-offset-2 hover:underline"
                onClick={() => setPlanOpen(true)}
              >
                upgrade
              </button>
              .
            </p>
          ) : hasSession ? (
            <p className="text-sm text-muted-foreground">
              Signed in on this device · {planBadge}
              {remaining !== null ? ` · ${remaining} quiz slot${remaining === 1 ? "" : "s"} left` : null}
              {isAnonymous ? " · guest session" : null}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No account needed to start — guest-first, like our other apps.
            </p>
          )}
        </div>
      </div>

      <ChangePlanForm
        open={planOpen}
        onOpenChange={setPlanOpen}
        currentPlan={planId}
        hasSession={hasSession}
        isAnonymous={isAnonymous}
      />
    </section>
  );
}
