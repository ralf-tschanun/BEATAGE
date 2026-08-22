import { notFound } from "next/navigation";
import Link from "next/link";
import { QuizPlayPanels } from "@/components/quiz-play-panels";
import { InviteShare } from "@/components/invite-share";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { BRAND_NAME } from "@/lib/brand";
import { quizSourceLabel } from "@/lib/quiz-settings";
import { getQuizPlayState } from "@/lib/quizzes/play-state";
import { getQuizDashboardData } from "@/lib/quizzes/dashboard";
import { getOptionalUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

type QuizPageProps = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ billing?: string }>;
};

type QuizMember = {
  id: string;
  display_name: string;
  role: string;
  joined_at: string;
};

export default async function QuizPage({ params, searchParams }: QuizPageProps) {
  const { code } = await params;
  const { billing } = await searchParams;
  const joinCode = code.trim().toUpperCase();
  const supabase = await createClient();
  const { user } = await getOptionalUser();
  const { identity, plan } = await getQuizDashboardData();

  const { data: preview, error } = await supabase.rpc("get_beatage_quiz_by_join_code", {
    p_join_code: joinCode,
  });

  if (error || !preview) {
    notFound();
  }

  const quiz = preview as {
    id: string;
    title: string;
    description: string | null;
    status: string;
    source: string;
    join_code: string;
    max_members: number | null;
    member_count: number;
  };

  const { data: members } = await supabase
    .from("beatage_quiz_members")
    .select("id, display_name, role, joined_at")
    .eq("quiz_id", quiz.id)
    .order("joined_at", { ascending: true });

  const memberRows = (members ?? []) as QuizMember[];

  let myRole: string | null = null;
  if (user) {
    const { data: myMembership } = await supabase
      .from("beatage_quiz_members")
      .select("role")
      .eq("quiz_id", quiz.id)
      .eq("user_id", user.id)
      .maybeSingle();
    myRole = (myMembership as { role?: string } | null)?.role ?? null;
  }

  const isHost = myRole === "host";
  const playState = myRole ? await getQuizPlayState(quiz.id, joinCode) : null;

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <SiteHeader identity={identity} currentPlan={plan.id} />

      {billing === "unlocked" ? (
        <p className="mx-auto w-full max-w-3xl px-6 pt-4 text-sm text-foreground">
          Thanks — this quiz is unlocked.
        </p>
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

        {myRole ? (
          <>
            <InviteShare
              joinUrl={`/j/${quiz.join_code}`}
              joinCode={quiz.join_code}
              contestTitle={quiz.title}
            />
            <QuizPlayPanels
              quizId={quiz.id}
              joinCode={joinCode}
              isHost={isHost}
              tracks={playState?.tracks ?? []}
              activeRound={playState?.activeRound ?? null}
              resultRound={playState?.resultRound ?? null}
              roundGuesses={playState?.roundGuesses ?? []}
              myGuessYear={playState?.myGuessYear ?? null}
              leaderboard={playState?.leaderboard ?? []}
            />
          </>
        ) : (
          <section className="rounded-2xl border border-border/60 bg-card/40 p-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Join this quiz to play along.
            </p>
            <Link
              href={`/j/${quiz.join_code}`}
              className={cn(buttonVariants())}
            >
              Join this quiz
            </Link>
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">
            Players ({memberRows.length}
            {quiz.max_members != null ? ` / ${quiz.max_members}` : ""})
          </h2>
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
