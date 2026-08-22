import { CreateWizardForm } from "@/components/create-wizard-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getDashboardData } from "@/lib/contests/dashboard";
import type { PlanId } from "@/lib/plans";

export default async function CreatePage() {
  const { plan, activeHostedCount, identity } = await getDashboardData();

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <SiteHeader identity={identity} currentPlan={plan.id as PlanId} />

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-10">
        <CreateWizardForm
            defaultHostName={identity?.displayName}
            planId={plan.id}
            activeHostedCount={activeHostedCount}
            hasSession={Boolean(identity)}
            isAnonymous={Boolean(identity?.isAnonymous)}
        />
      </main>

      <SiteFooter />
    </div>
  );
}
