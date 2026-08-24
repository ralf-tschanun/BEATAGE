import { redirect } from "next/navigation";
import Link from "next/link";
import { QuizPageHeader } from "@/components/quiz-page-header";
import { QuizPlayPanels } from "@/components/quiz-play-panels";
import { QuizLiveRefresh } from "@/components/quiz-live-refresh";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { BRAND_NAME } from "@/lib/brand";
import { quizSourceLabel } from "@/lib/quiz-settings";
import { getQuizPlayState } from "@/lib/quizzes/play-state";
import { getQuizDashboardData } from "@/lib/quizzes/dashboard";
import { ensureAnonymousSession } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type QuizPageProps = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ billing?: string; created?: string }>;
};

type QuizMember = {
  id: string;
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
  const { identity, plan, hosted, joined } = await getQuizDashboardData();

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

  let myRole: string | null = hosted.some((q) => q.join_code === joinCode)
    ? "host"
    : joined.some((q) => q.join_code === joinCode)
      ? "participant"
      : quiz.my_role ??
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

  const { data: members } = await supabase
    .from("beatage_quiz_members")
    .select("id, display_name, role, joined_at")
    .eq("quiz_id", quiz.id)
    .order("joined_at", { ascending: true });

  const memberRows = (members ?? []) as QuizMember[];
  const isHost = myRole === "host";
  const playState = await getQuizPlayState(quiz.id, joinCode);

  let unlockedAt: string | null = null;
  let quizStatus = quiz.status;
  try {
    const admin = createAdminClient();
    const { data: quizRow } = await admin
      .from("beatage_quizzes")
      .select("unlocked_at, status")
      .eq("id", quiz.id)
      .maybeSingle();
    unlockedAt = (quizRow as { unlocked_at?: string | null } | null)?.unlocked_at ?? null;
    quizStatus = (quizRow as { status?: string } | null)?.status ?? quiz.status;
  } catch {
    // Service role optional in some local setups.
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <SiteHeader
        identity={identity}
        currentPlan={plan.id}
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
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-6 pt-4">
          <p className="text-sm text-foreground">
            This quiz is waiting for unlock payment before players can join.
          </p>
          <a
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            href={
              identity?.isAnonymous
                ? `/billing/account?next=${encodeURIComponent(`/api/billing/checkout?sku=quiz_unlock&quizId=${quiz.id}`)}`
                : `/api/billing/checkout?sku=quiz_unlock&quizId=${encodeURIComponent(quiz.id)}`
            }
          >
            Complete unlock
          </a>
        </div>
      ) : null}

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-6 py-10">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{quiz.status}</Badge>
            <Badge variant="outline">{quizSourceLabel(quiz.source)}</Badge>
            <span className="text-sm text-muted-foreground">Code {quiz.join_code}</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{quiz.title}</h1>
          {quiz.description ? (
            <p className="text-muted-foreground">{quiz.description}</p>
          ) : null}
        </div>

        <QuizPageHeader
          title={quiz.title}
          joinCode={quiz.join_code}
          joinUrl={`/j/${quiz.join_code}`}
          openInviteOnMount={created === "1"}
          isHost={isHost}
        />
        <QuizLiveRefresh quizId={quiz.id} joinCode={joinCode} />
        <QuizPlayPanels
          quizId={quiz.id}
          joinCode={joinCode}
          isHost={isHost}
          quizSource={quiz.source}
          memberCount={memberRows.length || quiz.member_count || 0}
          tracks={playState?.tracks ?? []}
          currentRoundNumber={playState?.currentRoundNumber ?? 0}
          activeRound={playState?.activeRound ?? null}
          resultRound={playState?.resultRound ?? null}
          pastRounds={playState?.pastRounds ?? []}
          roundGuesses={playState?.roundGuesses ?? []}
          myGuessYear={playState?.myGuessYear ?? null}
          leaderboard={playState?.leaderboard ?? []}
          quizStatus={playState?.quizStatus ?? quiz.status}
          maxCuratedTracks={playState?.maxCuratedTracks ?? 10}
          isAnonymous={Boolean(identity?.isAnonymous)}
        />

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">
            Players ({memberRows.length || quiz.member_count}
            {quiz.max_members != null ? ` / ${quiz.max_members}` : ""})
          </h2>
          {memberRows.length > 0 ? (
            <ul className="divide-y divide-border/60 rounded-2xl border border-border/60">
              {memberRows.map((member) => (
                <li
                  key={member.id}
                  className="flex items-center justify-between px-4 py-3 text-sm"
                >
                  <span>{member.display_name}</span>
                  <span className="text-muted-foreground capitalize">{member.role}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {isHost ? "You are the host — share the invite code to add players." : null}
            </p>
          )}
        </section>

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
