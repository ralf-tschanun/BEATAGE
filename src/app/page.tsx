import { QuizList } from "@/components/quiz-list";
import { HomeHero } from "@/components/home-hero";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getQuizDashboardData } from "@/lib/quizzes/dashboard";
import type { PlanId } from "@/lib/quiz-plans";

type HomePageProps = {
  searchParams: Promise<{ billing?: string; removed?: string; deleted?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const { billing, removed, deleted } = await searchParams;
  const { hosted, joined, plan, canCreate, identity, activeHostedCount } =
    await getQuizDashboardData();

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <SiteHeader identity={identity} currentPlan={plan.id as PlanId} />

      {removed === "1" ? (
        <p className="mx-auto w-full max-w-5xl px-6 pt-4 text-sm text-foreground">
          That quiz is no longer available.
        </p>
      ) : null}

      {deleted === "1" ? (
        <p className="mx-auto w-full max-w-5xl px-6 pt-4 text-sm text-foreground">
          Quiz deleted.
        </p>
      ) : null}

      {billing ? (
        <p className="mx-auto w-full max-w-5xl px-6 pt-4 text-sm text-foreground">
          {billing === "success"
            ? "Thanks. Your plan updates in a few seconds — refresh if it still looks unchanged."
            : billing === "account"
              ? "Sign in with email before checkout."
              : billing === "unavailable"
                ? "Billing is not configured on this server yet."
                : billing === "invalid"
                  ? "That checkout link is not valid."
                  : null}
        </p>
      ) : null}

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 pb-16">
        <HomeHero
          canCreate={canCreate}
          planId={plan.id as PlanId}
          planLabel={plan.label}
          maxActiveQuizzes={plan.maxActiveQuizzes}
          activeHostedCount={activeHostedCount}
          hasSession={Boolean(identity)}
          isAnonymous={Boolean(identity?.isAnonymous)}
        />

        <div className="grid gap-8 px-6">
          <section id="hosted" className="scroll-mt-20">
            <QuizList
              title="Quizzes you host"
              sectionIcon="hosted"
              emptyText="You have not created a quiz on this device yet."
              quizzes={hosted}
              rowAction="delete"
            />
          </section>
          <section id="joined" className="scroll-mt-20">
            <QuizList
              title="Quizzes you joined"
              sectionIcon="joined"
              emptyText="You have not joined any quiz on this device yet."
              quizzes={joined}
              rowAction="leave"
            />
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
