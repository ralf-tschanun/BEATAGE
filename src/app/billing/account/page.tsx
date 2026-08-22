import { AccountAuthForm } from "@/components/account-auth-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getDashboardData } from "@/lib/contests/dashboard";
import type { PlanId } from "@/lib/plans";
import { safeNextPath } from "@/lib/site-url";

type BillingAccountPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function BillingAccountPage({
  searchParams,
}: BillingAccountPageProps) {
  const { next: rawNext } = await searchParams;
  const nextPath = safeNextPath(rawNext);
  const { plan, identity } = await getDashboardData();

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <SiteHeader identity={identity} currentPlan={plan.id as PlanId} />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-10">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Account for checkout
          </h1>
          <p className="text-sm text-muted-foreground">
            {identity?.isAnonymous
              ? "Create a new account or sign in to an existing one. Pending unlocks on this device move with you, then you continue to payment."
              : "Sign in with email, then continue to checkout."}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <AccountAuthForm
            hasSession={Boolean(identity)}
            isAnonymous={Boolean(identity?.isAnonymous)}
            email={identity?.email}
            displayName={identity?.displayName}
            nextPath={nextPath === "/" ? undefined : nextPath}
            preferSignup={Boolean(identity?.isAnonymous)}
          />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
