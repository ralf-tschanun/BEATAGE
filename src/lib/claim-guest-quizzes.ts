import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Move payment_pending unlock drafts from a guest user to a signed-in account.
 * Used when a guest signs in to an existing email login during checkout.
 */
export async function claimGuestPaymentPendingQuizzes(
  fromUserId: string,
  toUserId: string,
): Promise<{ claimed: number }> {
  if (!fromUserId || !toUserId || fromUserId === toUserId) {
    return { claimed: 0 };
  }

  const admin = createAdminClient();
  const { data: quizzes, error: listError } = await admin
    .from("beatage_quizzes")
    .select("id")
    .eq("host_user_id", fromUserId)
    .eq("status", "payment_pending");

  if (listError) {
    throw new Error(listError.message);
  }
  if (!quizzes?.length) {
    return { claimed: 0 };
  }

  const quizIds = quizzes.map((row) => row.id as string);

  const { error: hostError } = await admin
    .from("beatage_quizzes")
    .update({ host_user_id: toUserId })
    .in("id", quizIds)
    .eq("host_user_id", fromUserId);
  if (hostError) {
    throw new Error(hostError.message);
  }

  // Avoid unique (quiz_id, user_id) conflicts if the email user already has a row.
  await admin
    .from("beatage_quiz_members")
    .delete()
    .eq("user_id", toUserId)
    .in("quiz_id", quizIds);

  const { error: memberError } = await admin
    .from("beatage_quiz_members")
    .update({ user_id: toUserId })
    .eq("user_id", fromUserId)
    .in("quiz_id", quizIds);
  if (memberError) {
    throw new Error(memberError.message);
  }

  return { claimed: quizIds.length };
}
