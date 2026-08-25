import { getQuizPlanLimits, type PlanId } from "@/lib/quiz-plans";
import {
  resolveAccountDisplayName,
  shouldRepairHostPollutedProfile,
} from "@/lib/account-display-name";
import { getOptionalUser } from "@/lib/supabase/auth";

export type DashboardQuiz = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  source: string;
  join_code: string;
  max_members: number | null;
  expires_at: string | null;
  unlocked_at?: string | null;
  created_at: string;
  current_round_number?: number;
  my_display_name?: string | null;
  member_count?: number | null;
  /** Final placement when the quiz is finished/expired; null if unknown or not placed. */
  my_rank?: number | null;
};

export type DashboardIdentity = {
  userId: string;
  displayName: string | null;
  email: string | null;
  isAnonymous: boolean;
};

type DashboardRpcResult = {
  plan: PlanId;
  hosted: DashboardQuiz[];
  joined: DashboardQuiz[];
  active_hosted_count: number;
};

function parsePlanId(value: unknown): PlanId {
  return value === "plus" || value === "pro" ? value : "free";
}

/**
 * Lightweight identity + plan for quiz room pages.
 * Avoids get_beatage_dashboard (full hosted/joined lists) on every /q refresh.
 */
export async function getQuizPageShellData() {
  const { supabase, user, supabaseReachable } = await getOptionalUser();

  if (!user) {
    return {
      identity: null as DashboardIdentity | null,
      plan: getQuizPlanLimits("free"),
      supabaseReachable,
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, plan")
    .eq("id", user.id)
    .maybeSingle();

  const plan = getQuizPlanLimits(parsePlanId(profile?.plan));
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

  return {
    identity: {
      userId: user.id,
      displayName: repairedName ?? displayName,
      email: user.email ?? null,
      isAnonymous: Boolean(user.is_anonymous),
    } satisfies DashboardIdentity,
    plan,
    supabaseReachable,
  };
}

export async function getQuizDashboardData() {
  const { supabase, user, supabaseReachable } = await getOptionalUser();

  if (!user) {
    const limits = getQuizPlanLimits("free");
    return {
      user: null,
      identity: null as DashboardIdentity | null,
      hosted: [] as DashboardQuiz[],
      joined: [] as DashboardQuiz[],
      plan: limits,
      activeHostedCount: 0,
      canCreate: true,
      supabaseReachable,
    };
  }

  const [{ data: profile }, { data, error }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    supabase.rpc("get_beatage_dashboard"),
  ]);

  if (error) {
    if (
      /fetch failed|network|enotfound|econnrefused|etimedout/i.test(error.message)
    ) {
      const limits = getQuizPlanLimits("free");
      return {
        user: null,
        identity: null as DashboardIdentity | null,
        hosted: [] as DashboardQuiz[],
        joined: [] as DashboardQuiz[],
        plan: limits,
        activeHostedCount: 0,
        canCreate: true,
        supabaseReachable: false,
      };
    }
    throw new Error(error.message);
  }

  const payload = data as DashboardRpcResult;
  const plan = getQuizPlanLimits(payload.plan ?? "free");
  const activeHostedCount = payload.active_hosted_count ?? 0;
  const canCreate =
    plan.maxActiveQuizzes === null || activeHostedCount < plan.maxActiveQuizzes;

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

  return {
    user,
    identity: {
      userId: user.id,
      displayName: repairedName ?? displayName,
      email: user.email ?? null,
      isAnonymous: Boolean(user.is_anonymous),
    } satisfies DashboardIdentity,
    hosted: payload.hosted ?? [],
    joined: payload.joined ?? [],
    plan,
    activeHostedCount,
    canCreate,
    supabaseReachable: true,
  };
}
