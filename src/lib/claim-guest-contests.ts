import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Move payment_pending unlock drafts from a guest user to a signed-in account.
 * Used when a guest signs in to an existing email login during checkout.
 */
export async function claimGuestPaymentPendingContests(
  fromUserId: string,
  toUserId: string,
): Promise<{ claimed: number }> {
  if (!fromUserId || !toUserId || fromUserId === toUserId) {
    return { claimed: 0 };
  }

  const admin = createAdminClient();
  const { data: contests, error: listError } = await admin
    .from("contests")
    .select("id")
    .eq("host_user_id", fromUserId)
    .eq("status", "payment_pending");

  if (listError) {
    throw new Error(listError.message);
  }
  if (!contests?.length) {
    return { claimed: 0 };
  }

  const contestIds = contests.map((row) => row.id as string);

  const { error: hostError } = await admin
    .from("contests")
    .update({ host_user_id: toUserId })
    .in("id", contestIds)
    .eq("host_user_id", fromUserId);
  if (hostError) {
    throw new Error(hostError.message);
  }

  // Avoid unique (contest_id, user_id) conflicts if the email user already has a row.
  await admin
    .from("contest_members")
    .delete()
    .eq("user_id", toUserId)
    .in("contest_id", contestIds);

  const { error: memberError } = await admin
    .from("contest_members")
    .update({ user_id: toUserId })
    .eq("user_id", fromUserId)
    .in("contest_id", contestIds);
  if (memberError) {
    throw new Error(memberError.message);
  }

  // Host-seeded curated rows keep pointing at the host.
  await admin
    .from("candidates")
    .update({ nominator_user_id: toUserId })
    .eq("nominator_user_id", fromUserId)
    .in("contest_id", contestIds);

  return { claimed: contestIds.length };
}
