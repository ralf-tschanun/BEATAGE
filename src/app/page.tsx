import { ContestList } from "@/components/contest-list";
import { ContestLiveRefresh } from "@/components/contest-live-refresh";
import { DashboardLiveRefresh } from "@/components/dashboard-live-refresh";
import { HomeHero } from "@/components/home-hero";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getDashboardData } from "@/lib/contests/dashboard";
import type { PlanId } from "@/lib/plans";

type HomePageProps = {
  searchParams: Promise<{ billing?: string; removed?: string; left?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const { billing, removed, left } = await searchParams;
  const { hosted, joined, plan, canCreate, identity, activeHostedCount } =
    await getDashboardData();

  const liveContestIds = [...hosted, ...joined].map((contest) => contest.id);

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      {identity ? (
        <>
          <DashboardLiveRefresh
            userId={identity.userId}
            contestIds={liveContestIds}
          />
          {liveContestIds.map((contestId) => (
            <ContestLiveRefresh key={contestId} contestId={contestId} />
          ))}
        </>
      ) : null}

      <SiteHeader identity={identity} currentPlan={plan.id as PlanId} />

      {removed === "1" ? (
        <p className="mx-auto w-full max-w-5xl px-6 pt-4 text-sm text-foreground">
          You were removed from that contest. It no longer appears in your joined
          list. To join again, enter or scan the invite code on the Join page.
        </p>
      ) : null}

      {left === "1" ? (
        <p className="mx-auto w-full max-w-5xl px-6 pt-4 text-sm text-foreground">
          You left the contest.
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
          maxActiveContests={plan.maxActiveContests}
          activeHostedCount={activeHostedCount}
          hasSession={Boolean(identity)}
          isAnonymous={Boolean(identity?.isAnonymous)}
        />

        <div className="grid gap-8 px-6">
          <section id="hosted" className="scroll-mt-20">
            <ContestList
              title="Contests you host"
              sectionIcon="hosted"
              emptyText="You have not created a contest on this device yet."
              contests={hosted}
              rowAction="delete"
            />
          </section>
          <section id="joined" className="scroll-mt-20">
            <ContestList
              title="Contests you joined"
              sectionIcon="joined"
              emptyText="You have not joined any contest on this device yet."
              contests={joined}
              rowAction="leave"
            />
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
