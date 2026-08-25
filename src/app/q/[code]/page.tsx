import { redirect } from "next/navigation";
import Link from "next/link";
import { QuizPageHeader } from "@/components/quiz-page-header";
import { QuizStatusBadges } from "@/components/quiz-status-badges";
import { QuizPlayPanels } from "@/components/quiz-play-panels";
import { QuizRulesContent } from "@/components/quiz-rules-content";
import { QuizLiveRefresh } from "@/components/quiz-live-refresh";
import { PlayersList } from "@/components/players-list";
import { QuizPendingUnlockBanner } from "@/components/quiz-pending-unlock-banner";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { BRAND_NAME } from "@/lib/brand";
import { getQuizPlanLimits, type PlanId } from "@/lib/quiz-plans";
import { DEFAULT_QUIZ_SETTINGS } from "@/lib/quiz-settings";
import { resolveQuizSettings } from "@/lib/quiz-scoring";
import { getQuizPlayState } from "@/lib/quizzes/play-state";
import { getQuizPageShellData } from "@/lib/quizzes/dashboard";
import { ensureAnonymousSession } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type QuizPageProps = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ billing?: string; created?: string }>;
};

type QuizMember = {
  id: string;
  user_id: string;
  display_name: string;
  role: string;
  joined_at: string;
};

export default async function QuizPage({ params, searchParams }: QuizPageProps) {
  const { code } = await params;
  const { billing, created } = await searchParams;
  const joinCode = code.trim().toUpperCase();
  const { user } = await ensureAnonymousSession();
  const supabase = await createClient();
  const { identity, plan } = await getQuizPageShellData();

  const { data: preview, error } = await supabase.rpc("get_beatage_quiz_by_join_code", {
    p_join_code: joinCode,
  });

  if (error || !preview) {
    redirect("/?removed=1");
  }

  const quiz = preview as {
    id: string;
    title: string;
    description: string | null;
    status: string;
    source: string;
    join_code: string;
    host_user_id?: string;
    max_members: number | null;
    member_count: number;
    my_role?: string | null;
    is_host?: boolean;
  };

  let myRole: string | null =
    quiz.my_role ??
    (quiz.is_host ? "host" : null) ??
    (quiz.host_user_id === user.id ? "host" : null);

  // Admin fallback: outdated get_beatage_quiz_by_join_code may omit is_host/my_role,
  // and RLS can hide membership right after create — without this the host lands on /j/.
  if (!myRole) {
    try {
      const admin = createAdminClient();
      const { data: membership } = await admin
        .from("beatage_quiz_members")
        .select("role")
        .eq("quiz_id", quiz.id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (membership?.role === "host" || membership?.role === "participant") {
        myRole = membership.role;
      } else {
        const { data: quizRow } = await admin
          .from("beatage_quizzes")
          .select("host_user_id")
          .eq("id", quiz.id)
          .maybeSingle();
        if (quizRow?.host_user_id === user.id) {
          myRole = "host";
        }
      }
    } catch {
      // Service role missing in local/dev — keep myRole null and send to join.
    }
  }

  if (!myRole) {
    redirect(`/j/${joinCode}`);
  }

  const isHost = myRole === "host";
  const playState = await getQuizPlayState(quiz.id, joinCode);

  // Prefer service role for the roster: RLS on beatage_quiz_members is
  // self-referential and often returns [] for the user-scoped client even when
  // the host is clearly a member (member_count still comes from security definer).
  let memberRows: QuizMember[] = [];
  let unlockedAt: string | null = null;
  let quizStatus = quiz.status;
  let createdAt: string | null = null;
  let settings = { ...DEFAULT_QUIZ_SETTINGS };

  try {
    const admin = createAdminClient();
    const [{ data: members }, { data: quizRow }] = await Promise.all([
      admin
        .from("beatage_quiz_members")
        .select("id, user_id, display_name, role, joined_at")
        .eq("quiz_id", quiz.id)
        .order("joined_at", { ascending: true }),
      admin
        .from("beatage_quizzes")
        .select("unlocked_at, status, settings, created_at")
        .eq("id", quiz.id)
        .maybeSingle(),
    ]);
    memberRows = (members ?? []) as QuizMember[];
    unlockedAt = (quizRow as { unlocked_at?: string | null } | null)?.unlocked_at ?? null;
    quizStatus = (quizRow as { status?: string } | null)?.status ?? quiz.status;
    createdAt = (quizRow as { created_at?: string | null } | null)?.created_at ?? null;
    settings = resolveQuizSettings(
      (quizRow as { settings?: unknown } | null)?.settings,
    );
  } catch {
    // Service role optional in some local setups — fall back to user client.
    const { data: members } = await supabase
      .from("beatage_quiz_members")
      .select("id, user_id, display_name, role, joined_at")
      .eq("quiz_id", quiz.id)
      .order("joined_at", { ascending: true });
    memberRows = (members ?? []) as QuizMember[];
  }

  const lastSubmittedByUserId = playState?.lastSubmittedByUserId ?? {};
  const trackCount = playState?.trackCount ?? playState?.tracks?.length ?? 0;

  let hostPlanId: PlanId = plan.id;
  let canContinueWithPlan = false;
  if (isHost) {
    try {
      const admin = createAdminClient();
      const [{ data: beatageProfile }, { count: activeCount }] = await Promise.all([
        admin
          .from("beatage_profiles")
          .select("plan")
          .eq("id", user.id)
          .maybeSingle(),
        quizStatus === "payment_pending"
          ? admin
              .from("beatage_quizzes")
              .select("id", { count: "exact", head: true })
              .eq("host_user_id", user.id)
              .in("status", ["draft", "open", "playing"])
              .is("unlocked_at", null)
          : Promise.resolve({ count: null as number | null }),
      ]);
      const parsed =
        beatageProfile?.plan === "plus" || beatageProfile?.plan === "pro"
          ? beatageProfile.plan
          : "free";
      hostPlanId = parsed;
      if (quizStatus === "payment_pending") {
        const hostPlan = getQuizPlanLimits(parsed);
        canContinueWithPlan =
          hostPlan.maxActiveQuizzes === null ||
          (activeCount ?? 0) < hostPlan.maxActiveQuizzes;
      }
    } catch {
      // Service role optional — keep Complete unlock only.
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <SiteHeader
        identity={identity}
        currentPlan={hostPlanId}
        unlockContest={
          isHost
            ? { id: quiz.id, unlocked: Boolean(unlockedAt) }
            : null
        }
      />

      {billing === "unlocked" ? (
        <p className="mx-auto w-full max-w-3xl px-6 pt-4 text-sm text-foreground">
          Thanks — this quiz is unlocked.
        </p>
      ) : null}

      {isHost && quizStatus === "payment_pending" ? (
        <QuizPendingUnlockBanner
          quizId={quiz.id}
          joinCode={quiz.join_code}
          planId={hostPlanId}
          trackCount={trackCount}
          canContinueWithPlan={canContinueWithPlan}
          isAnonymous={Boolean(identity?.isAnonymous)}
        />
      ) : null}

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-6 py-10">
        <div className="space-y-1">
          <QuizPageHeader
            title={quiz.title}
            joinCode={quiz.join_code}
            joinUrl={`/j/${quiz.join_code}`}
            openInviteOnMount={created === "1"}
            rulesContent={
              <QuizRulesContent
                joinCode={quiz.join_code}
                createdAt={createdAt}
                source={quiz.source}
                settings={settings}
                trackCount={trackCount}
              />
            }
          />
          <QuizStatusBadges
            quizId={quiz.id}
            quizSource={quiz.source}
            initialQuizStatus={playState?.quizStatus ?? quizStatus}
            initialHasActiveRound={Boolean(playState?.activeRound)}
            initialCurrentRoundNumber={playState?.currentRoundNumber ?? 0}
            initialAutoInterrupted={playState?.autoInterrupted ?? false}
            initialOverallReveal={settings.overallReveal}
            initialLeaderboardRevealStep={playState?.leaderboardRevealStep ?? 0}
            initialLeaderboardCount={playState?.leaderboard?.length ?? 0}
          />
          {quiz.description ? (
            <p className="pt-2 text-muted-foreground">{quiz.description}</p>
          ) : null}
        </div>
        <QuizLiveRefresh quizId={quiz.id} joinCode={joinCode} />
        <QuizPlayPanels
          quizId={quiz.id}
          joinCode={joinCode}
          isHost={isHost}
          quizSource={quiz.source}
          memberCount={memberRows.length || quiz.member_count || 0}
          tracks={playState?.tracks ?? []}
          trackCount={trackCount}
          currentRoundNumber={playState?.currentRoundNumber ?? 0}
          activeRound={playState?.activeRound ?? null}
          resultRound={playState?.resultRound ?? null}
          pastRounds={playState?.pastRounds ?? []}
          roundGuesses={playState?.roundGuesses ?? []}
          myGuessYear={playState?.myGuessYear ?? null}
          myGuessWasNumberOne={playState?.myGuessWasNumberOne ?? null}
          leaderboard={playState?.leaderboard ?? []}
          quizStatus={playState?.quizStatus ?? quiz.status}
          maxCuratedTracks={playState?.maxCuratedTracks ?? 10}
          maxMembers={quiz.max_members}
          settings={settings}
          autoInterrupted={playState?.autoInterrupted ?? false}
          leaderboardRevealStep={playState?.leaderboardRevealStep ?? 0}
          isAnonymous={Boolean(identity?.isAnonymous)}
          currentUserId={user.id}
          hostUserId={
            quiz.host_user_id ??
            memberRows.find((member) => member.role === "host")?.user_id ??
            null
          }
          planId={hostPlanId}
          unlocked={Boolean(unlockedAt)}
        />

        <PlayersList
          quizId={quiz.id}
          joinCode={joinCode}
          currentUserId={user.id}
          isHost={isHost}
          maxMembers={quiz.max_members}
          members={memberRows.map((member) => ({
            id: member.id,
            userId: member.user_id,
            displayName: member.display_name,
            role: member.role,
            joinedAt: member.joined_at,
            lastSubmittedAt: lastSubmittedByUserId[member.user_id] ?? null,
          }))}
        />

        <p className="text-sm text-muted-foreground">
          <Link href="/" className="underline-offset-2 hover:underline">
            ← Back to {BRAND_NAME}
          </Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
