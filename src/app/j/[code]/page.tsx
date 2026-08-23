import { notFound, redirect } from "next/navigation";
import { JoinQuizDialog } from "@/components/join-quiz-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOptionalUser } from "@/lib/supabase/auth";

type JoinPageProps = {
  params: Promise<{ code: string }>;
};

type QuizPreview = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  max_members: number | null;
  member_count: number;
  is_full: boolean;
};

export default async function JoinByCodePage({ params }: JoinPageProps) {
  const { code } = await params;
  const joinCode = code.trim().toUpperCase();
  const { supabase, user } = await getOptionalUser();

  const { data: preview, error } = await supabase.rpc("get_beatage_quiz_by_join_code", {
    p_join_code: joinCode,
  });

  if (error || !preview) {
    notFound();
  }

  const quiz = preview as QuizPreview;

  let defaultDisplayName: string | null = null;

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();

    let isMember = false;
    const { data: membership } = await supabase
      .from("beatage_quiz_members")
      .select("id")
      .eq("quiz_id", quiz.id)
      .eq("user_id", user.id)
      .maybeSingle();
    isMember = Boolean(membership);

    if (!isMember) {
      try {
        const admin = createAdminClient();
        const { data: adminMembership } = await admin
          .from("beatage_quiz_members")
          .select("id")
          .eq("quiz_id", quiz.id)
          .eq("user_id", user.id)
          .maybeSingle();
        isMember = Boolean(adminMembership);
        if (!isMember) {
          const { data: quizRow } = await admin
            .from("beatage_quizzes")
            .select("host_user_id")
            .eq("id", quiz.id)
            .maybeSingle();
          isMember = quizRow?.host_user_id === user.id;
        }
      } catch {
        // ignore missing service role
      }
    }

    if (isMember) {
      redirect(`/q/${joinCode}`);
    }

    defaultDisplayName = profile?.display_name ?? null;
  }

  const blocked =
    quiz.is_full ||
    quiz.status === "expired" ||
    !["open", "playing"].includes(quiz.status);

  const blockedMessage = blocked
    ? quiz.status === "expired"
      ? "This quiz has expired."
      : quiz.is_full
        ? "This quiz is full."
        : "This quiz is not open for joining."
    : null;

  return (
    <JoinQuizDialog
      joinCode={joinCode}
      quizTitle={quiz.title}
      description={quiz.description}
      memberCount={quiz.member_count}
      maxMembers={quiz.max_members}
      blockedMessage={blockedMessage}
      defaultDisplayName={defaultDisplayName}
    />
  );
}
