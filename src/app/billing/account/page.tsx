import { AccountAuthForm } from "@/components/account-auth-form";
import { QuizPendingUnlockBanner } from "@/components/quiz-pending-unlock-banner";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getQuizDashboardData } from "@/lib/quizzes/dashboard";
import type { PlanId } from "@/lib/quiz-plans";
import { safeNextPath } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";

type BillingAccountPageProps = {
  searchParams: Promise<{ next?: string; auth?: string }>;
};

function parseUnlockQuizId(nextPath: string): string | null {
  if (!nextPath.startsWith("/api/billing/checkout")) return null;
  try {
    const url = new URL(nextPath, "http://local.invalid");
    if (url.searchParams.get("sku") !== "quiz_unlock") return null;
    const quizId =
      url.searchParams.get("quizId")?.trim() ||
      url.searchParams.get("contestId")?.trim() ||
      "";
    return quizId || null;
  } catch {
    return null;
  }
}

export default async function BillingAccountPage({
  searchParams,
}: BillingAccountPageProps) {
  const { next: rawNext, auth } = await searchParams;
  const nextPath = safeNextPath(rawNext);
  const authLinkError = auth === "error";
  const { plan, identity, canCreate, hosted } = await getQuizDashboardData();
  const unlockQuizId = parseUnlockQuizId(nextPath === "/" ? "" : nextPath);

  let pendingUnlock: {
    quizId: string;
    joinCode: string;
    trackCount: number;
    canContinueWithPlan: boolean;
  } | null = null;

  if (unlockQuizId && identity) {
    const hostedPending = hosted.find(
      (quiz) => quiz.id === unlockQuizId && quiz.status === "payment_pending",
    );
    let joinCode = hostedPending?.join_code ?? "";
    let trackCount = 0;
    let status = hostedPending?.status ?? "";

    try {
      const admin = createAdminClient();
      const [{ data: quizRow }, { count }] = await Promise.all([
        admin
          .from("beatage_quizzes")
          .select("join_code, status, host_user_id")
          .eq("id", unlockQuizId)
          .maybeSingle(),
        admin
          .from("beatage_curated_tracks")
          .select("id", { count: "exact", head: true })
          .eq("quiz_id", unlockQuizId),
      ]);
      if (quizRow?.host_user_id === identity.userId) {
        joinCode = String(quizRow.join_code ?? joinCode);
        status = String(quizRow.status ?? status);
        trackCount = count ?? 0;
      }
    } catch {
      // Fall back to dashboard row only.
    }

    if (status === "payment_pending" && joinCode) {
      pendingUnlock = {
        quizId: unlockQuizId,
        joinCode,
        trackCount,
        canContinueWithPlan: canCreate,
      };
    }
  }

  const planId = plan.id as PlanId;

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <SiteHeader identity={identity} currentPlan={planId} />
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

        {pendingUnlock ? (
          <QuizPendingUnlockBanner
            quizId={pendingUnlock.quizId}
            joinCode={pendingUnlock.joinCode}
            planId={planId}
            trackCount={pendingUnlock.trackCount}
            canContinueWithPlan={pendingUnlock.canContinueWithPlan}
            isAnonymous={Boolean(identity?.isAnonymous)}
            hideUnlockLink
            className="max-w-none px-0 pt-0"
          />
        ) : null}

        {pendingUnlock?.canContinueWithPlan ? (
          <p className="text-sm text-muted-foreground">
            Prefer unlock limits instead? Create or sign in below, then continue
            to payment.
          </p>
        ) : null}

        <div className="rounded-xl border border-border bg-card p-4">
          <AccountAuthForm
            hasSession={Boolean(identity)}
            isAnonymous={Boolean(identity?.isAnonymous)}
            email={identity?.email}
            displayName={identity?.displayName}
            nextPath={nextPath === "/" ? undefined : nextPath}
            preferSignup={Boolean(identity?.isAnonymous)}
            authLinkError={authLinkError}
          />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
