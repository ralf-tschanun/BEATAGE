import { AuthLinkErrorBanner } from "@/components/account-auth-form";
import { QuizList } from "@/components/quiz-list";
import { HomeHero } from "@/components/home-hero";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getQuizDashboardData } from "@/lib/quizzes/dashboard";
import type { PlanId } from "@/lib/quiz-plans";
import { SISTER_SITE_LANDING, SISTER_SITE_NAME } from "@/lib/site-url";

type HomePageProps = {
  searchParams: Promise<{
    billing?: string;
    removed?: string;
    deleted?: string;
    auth?: string;
  }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const { billing, removed, deleted, auth } = await searchParams;
  const { hosted, joined, plan, canCreate, identity, activeHostedCount, supabaseReachable } =
    await getQuizDashboardData();

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <SiteHeader identity={identity} currentPlan={plan.id as PlanId} />

      {!supabaseReachable ? (
        <p className="mx-auto w-full max-w-5xl px-6 pt-4 text-sm text-destructive" role="alert">
          Cannot reach Supabase right now (network or project still restoring after
          suspend). Check the project is Active in the Supabase dashboard, confirm{" "}
          <code className="text-xs">NEXT_PUBLIC_SUPABASE_URL</code> matches, then
          restart <code className="text-xs">npm run dev</code> and hard-refresh.
        </p>
      ) : null}
      {auth === "error" ? <AuthLinkErrorBanner /> : null}
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
        <p
          className={`mx-auto w-full max-w-5xl px-6 pt-4 text-sm ${
            billing === "portal_error" ? "text-destructive" : "text-foreground"
          }`}
          role={billing === "portal_error" ? "alert" : undefined}
        >
          {billing === "success"
            ? "Thanks. Your plan updates in a few seconds — refresh if it still looks unchanged."
            : billing === "account"
              ? "Sign in with email before checkout."
              : billing === "unavailable"
                ? "Billing is not configured on this server yet."
                : billing === "error"
                  ? "Checkout could not start. Please try again in a moment."
                : billing === "portal_error"
                  ? "Billing portal could not open. Make sure you subscribed with the same email you use here, then try again — or contact us and we will cancel for you."
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

        <p className="px-6 text-center text-sm text-muted-foreground">
          Looking for an online song contest?{" "}
          <a
            href={SISTER_SITE_LANDING}
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            Nominate, vote, reveal winners on {SISTER_SITE_NAME} →
          </a>
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
