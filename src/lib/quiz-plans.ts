export type PlanId = "free" | "plus" | "pro";

export type QuizPlanLimits = {
  id: PlanId;
  label: string;
  maxActiveQuizzes: number | null;
  maxMembers: number | null;
  inactivityExpiryDays: number | null;
};

export const QUIZ_PLANS: Record<PlanId, QuizPlanLimits> = {
  free: {
    id: "free",
    label: "Free",
    maxActiveQuizzes: 1,
    maxMembers: 10,
    inactivityExpiryDays: 7,
  },
  plus: {
    id: "plus",
    label: "Plus",
    maxActiveQuizzes: 5,
    maxMembers: 20,
    inactivityExpiryDays: 183,
  },
  pro: {
    id: "pro",
    label: "Pro",
    maxActiveQuizzes: null,
    maxMembers: null,
    inactivityExpiryDays: null,
  },
};

export const ACTIVE_QUIZ_STATUSES = ["draft", "open", "playing"] as const;

export function getQuizPlanLimits(plan: PlanId = "free"): QuizPlanLimits {
  return QUIZ_PLANS[plan] ?? QUIZ_PLANS.free;
}
