import type { Metadata } from "next";
import { CreateQuizWizardForm } from "@/components/create-quiz-wizard-form";
import { getQuizDashboardData } from "@/lib/quizzes/dashboard";
import { ensureAnonymousSession } from "@/lib/supabase/auth";
import type { PlanId } from "@/lib/quiz-plans";
import { BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Create a quiz",
  description: `Create a ${BRAND_NAME} music year quiz, pick sources and scoring, then invite friends with a code or QR.`,
  alternates: {
    canonical: "/create",
  },
};

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
