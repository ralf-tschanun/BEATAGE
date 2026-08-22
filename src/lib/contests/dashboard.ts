import {
  getPlanLimits,
  type PlanId,
} from "@/lib/plans";
import {
  resolveAccountDisplayName,
  shouldRepairHostPollutedProfile,
} from "@/lib/account-display-name";
import { getOptionalUser } from "@/lib/supabase/auth";

export type DashboardContest = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  mode: string;
  theme?: string | null;
  nomination_kind?: string | null;
  candidate_source?: string | null;
  candidate_reveal?: string | null;
  nomination_duration_seconds?: number | null;
  join_code: string;
  max_members: number | null;
  expires_at: string | null;
  unlocked_at?: string | null;
  created_at: string;
  my_display_name?: string | null;
  member_count?: number | null;
  nominations_open?: boolean | null;
  voting_open?: boolean | null;
  nomination_deadline?: string | null;
  voting_closes_at?: string | null;
  results_phase?: string | null;
  results_reveal?: string | null;
  results_reveal_step?: number | null;
  nominator_reveal_step?: number | null;
};

export type DashboardIdentity = {
  userId: string;
  displayName: string | null;
  email: string | null;
  isAnonymous: boolean;
};

type DashboardRpcResult = {
  plan: PlanId;
  hosted: DashboardContest[];
  joined: DashboardContest[];
  active_hosted_count: number;
};

export async function getDashboardData() {
  const { supabase, user } = await getOptionalUser();

  if (!user) {
    const limits = getPlanLimits("free");
    return {
      user: null,
      identity: null as DashboardIdentity | null,
      hosted: [] as DashboardContest[],
      joined: [] as DashboardContest[],
      plan: limits,
      activeHostedCount: 0,
      canCreate: true,
    };
  }

  const [{ data: profile }, { data, error }, { data: pendingHosted }] =
    await Promise.all([
      supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
      supabase.rpc("get_my_dashboard"),
      // RPC hides payment_pending; surface them so unlock can be finished.
      supabase
        .from("contests")
        .select(
          `
      id, title, description, status, mode, theme, nomination_kind, candidate_source,
      candidate_reveal, nomination_duration_seconds, join_code, max_members, expires_at,
      unlocked_at, created_at, nominations_open, voting_open, nomination_deadline,
      voting_closes_at, results_phase, results_reveal, results_reveal_step, nominator_reveal_step
    `,
        )
        .eq("host_user_id", user.id)
        .eq("status", "payment_pending")
        .order("created_at", { ascending: false }),
    ]);

  if (error) {
    throw new Error(error.message);
  }

  const payload = data as DashboardRpcResult;
  const plan = getPlanLimits(payload.plan ?? "free");
  const activeHostedCount = payload.active_hosted_count ?? 0;
  const canCreate = true;

  const displayName = resolveAccountDisplayName(user, profile?.display_name);
  const repairedName = shouldRepairHostPollutedProfile(
    profile?.display_name,
    user,
  );
  if (repairedName) {
    await supabase
      .from("profiles")
      .update({
        display_name: repairedName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);
  }

  const pendingRows = (pendingHosted ?? []) as DashboardContest[];
  const hostedIds = new Set((payload.hosted ?? []).map((c) => c.id));
  const hosted = [
    ...pendingRows.filter((c) => !hostedIds.has(c.id)),
    ...(payload.hosted ?? []),
  ];

  return {
    user,
    identity: {
      userId: user.id,
      displayName: repairedName ?? displayName,
      email: user.email ?? null,
      isAnonymous: Boolean(user.is_anonymous),
    } satisfies DashboardIdentity,
    hosted,
    joined: payload.joined ?? [],
    plan,
    activeHostedCount,
    canCreate,
  };
}
