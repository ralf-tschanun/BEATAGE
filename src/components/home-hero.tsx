"use client";

import { useState } from "react";
import Link from "next/link";
import { PlusCircleIcon, TicketIcon } from "@phosphor-icons/react";
import { ChangePlanForm } from "@/components/change-plan-form";
import { buttonVariants } from "@/components/ui/button";
import type { PlanId } from "@/lib/plans";
import { cn } from "@/lib/utils";

type HomeHeroProps = {
  canCreate: boolean;
  planId: PlanId;
  planLabel: string;
  maxActiveContests: number | null;
  activeHostedCount: number;
  hasSession: boolean;
  isAnonymous: boolean;
};

export function HomeHero({
  canCreate,
  planId,
  planLabel,
  maxActiveContests,
  activeHostedCount,
  hasSession,
  isAnonymous,
}: HomeHeroProps) {
  const [planOpen, setPlanOpen] = useState(false);
  const remaining =
    maxActiveContests === null
      ? null
      : Math.max(0, maxActiveContests - activeHostedCount);
  const atLimit = maxActiveContests !== null && remaining === 0;
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
            Create a contest in a few seconds.
          </h1>
          <p className="text-xl font-medium tracking-tight text-foreground/90 sm:text-2xl">
            Invite friends. Vote together.
          </p>
          <p className="text-lg leading-relaxed text-muted-foreground">
            A generic ranking platform for songs, photos, tastings and whatever
            your group wants to crown tonight.
          </p>
        </div>

        <div className="mx-auto w-full max-w-xl space-y-3 min-[440px]:max-w-2xl">
          <div className="grid w-full grid-cols-1 gap-3 min-[440px]:grid-cols-2">
            {canCreate ? (
              <Link
                href="/create"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "h-14 w-full px-6 text-base font-semibold sm:text-lg",
                )}
              >
                <PlusCircleIcon data-icon="inline-start" weight="duotone" />
                Create a contest
              </Link>
            ) : (
              <span
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "pointer-events-none h-14 w-full px-6 text-base font-semibold opacity-50 sm:text-lg",
                )}
                aria-disabled="true"
                title="Active contest limit reached for your plan"
              >
                <PlusCircleIcon data-icon="inline-start" weight="duotone" />
                Create a contest
              </span>
            )}
            <Link
              href="/join"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "h-14 w-full px-6 text-base font-semibold sm:text-lg",
              )}
            >
              <TicketIcon data-icon="inline-start" weight="duotone" />
              I have an invite code
            </Link>
          </div>

          <p className="text-sm text-muted-foreground">
            {maxActiveContests === null ? (
              <>Unlimited contests on your {planBadge}.</>
            ) : atLimit ? (
              <>
                You&apos;ve used your {maxActiveContests} included contest
                {maxActiveContests === 1 ? "" : "s"} on {planBadge}. You can still
                create an extra contest with a one-time unlock, or{" "}
                <button
                  type="button"
                  className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
                  onClick={() => setPlanOpen(true)}
                >
                  upgrade your plan
                </button>
                .
              </>
            ) : (
              <>
                {remaining} of {maxActiveContests} contests available on your{" "}
                {planBadge}.
              </>
            )}
          </p>
        </div>
      </div>

      <ChangePlanForm
        currentPlan={planId}
        hasSession={hasSession}
        isAnonymous={isAnonymous}
        open={planOpen}
        onOpenChange={setPlanOpen}
        showTrigger={false}
      />
    </section>
  );
}
