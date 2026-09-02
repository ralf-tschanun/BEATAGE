export type PlanId = "free" | "plus" | "pro";

export type QuizPlanLimits = {
  id: PlanId;
  label: string;
  maxActiveQuizzes: number | null;
  maxMembers: number | null;
  /** Curated songs per quiz; null = unlimited. */
  maxCuratedTracks: number | null;
  inactivityExpiryDays: number | null;
};

export const QUIZ_PLANS: Record<PlanId, QuizPlanLimits> = {
  free: {
    id: "free",
    label: "Free",
    maxActiveQuizzes: 1,
    maxMembers: 10,
    maxCuratedTracks: 10,
    inactivityExpiryDays: 7,
  },
  plus: {
    id: "plus",
    label: "Plus",
    maxActiveQuizzes: 5,
    maxMembers: 30,
    maxCuratedTracks: 30,
    inactivityExpiryDays: 183,
  },
  pro: {
    id: "pro",
    label: "Pro",
    maxActiveQuizzes: 10,
    maxMembers: 100,
    maxCuratedTracks: 100,
    inactivityExpiryDays: null,
  },
};

/** One-time quiz unlock caps (does not count toward active quiz limit). */
export const QUIZ_UNLOCK_LIMITS = {
  maxMembers: 100,
  maxCuratedTracks: 100,
} as const;

/** Default song cap when a quiz row has no max_rounds and is not unlocked. */
export const DEFAULT_MAX_CURATED_TRACKS: number =
  QUIZ_PLANS.free.maxCuratedTracks ?? 10;

export const ACTIVE_QUIZ_STATUSES = ["draft", "open", "playing"] as const;

export function getQuizPlanLimits(plan: PlanId = "free"): QuizPlanLimits {
  return QUIZ_PLANS[plan] ?? QUIZ_PLANS.free;
}

/** Team mode is a Plus/Pro feature (not available on Free). */
export function planAllowsQuizTeams(plan: PlanId = "free"): boolean {
  return plan === "plus" || plan === "pro";
}
