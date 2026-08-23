import { CreateQuizWizardForm } from "@/components/create-quiz-wizard-form";
import { getQuizDashboardData } from "@/lib/quizzes/dashboard";
import { ensureAnonymousSession } from "@/lib/supabase/auth";
import type { PlanId } from "@/lib/quiz-plans";

export default async function CreatePage() {
  await ensureAnonymousSession();
  const { identity, plan, activeHostedCount, canCreate } = await getQuizDashboardData();

  return (
    <CreateQuizWizardForm
      defaultHostName={identity?.displayName}
      planId={plan.id as PlanId}
      activeHostedCount={activeHostedCount}
      canCreate={canCreate}
      hasSession={Boolean(identity)}
      isAnonymous={identity?.isAnonymous ?? true}
    />
  );
}
