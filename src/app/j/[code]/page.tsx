import { notFound, redirect } from "next/navigation";
import { JoinContestDialog } from "@/components/join-contest-form";
import { getOptionalUser } from "@/lib/supabase/auth";

type JoinPageProps = {
  params: Promise<{ code: string }>;
};

type ContestPreview = {
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

  const { data: preview, error } = await supabase.rpc("get_contest_by_join_code", {
    p_join_code: joinCode,
  });

  if (error || !preview) {
    notFound();
  }

  const contest = preview as ContestPreview;

  let defaultDisplayName: string | null = null;

  if (user) {
    const [{ data: membership }, { data: profile }] = await Promise.all([
      supabase
        .from("contest_members")
        .select("id")
        .eq("contest_id", contest.id)
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle(),
    ]);

    if (membership) {
      redirect(`/c/${joinCode}`);
    }

    defaultDisplayName = profile?.display_name ?? null;
  }

  const blocked =
    contest.is_full ||
    contest.status === "expired" ||
    !["open", "voting"].includes(contest.status);

  const blockedMessage = blocked
    ? contest.status === "expired"
      ? "This contest has expired."
      : contest.is_full
        ? "This contest is full."
        : "This contest is not open for joining."
    : null;

  return (
    <JoinContestDialog
      joinCode={joinCode}
      contestTitle={contest.title}
      description={contest.description}
      memberCount={contest.member_count}
      maxMembers={contest.max_members}
      blockedMessage={blockedMessage}
      defaultDisplayName={defaultDisplayName}
    />
  );
}
