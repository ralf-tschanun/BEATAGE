import {
  anythingCuratedFilledCount,
  type CreateWizardState,
} from "@/lib/create-wizard";
import {
  getPlanLimits,
  type CandidateSource,
  type PlanId,
} from "@/lib/plans";

export type PlanLimitOverage = {
  nominationsPerParticipant: boolean;
  curatedCandidates: boolean;
};

export type PlanLimitOverageSummary = PlanLimitOverage & {
  nominationCount: number;
  nominationPlanMax: number | null;
  curatedCount: number;
  curatedPlanMax: number | null;
  /** Plan participant cap; null = unlimited (Pro / unlocked). */
  participantPlanMax: number | null;
};

function curatedCandidateCount(state: CreateWizardState): number {
  if (state.contestType === "anything") {
    return anythingCuratedFilledCount(state);
  }
  if (state.theme === "song" && state.nominationKind !== "birthday") {
    return state.draftSongs.filter((s) => s.title.trim() && s.artist.trim()).length;
  }
  if (state.theme === "photo") {
    return state.draftPhotos.filter((p) => p.file || p.title.trim()).length;
  }
  if (state.nominationKind === "birthday" && state.birthdayMode === "curated") {
    return state.draftBirthdayEntries.filter(
      (e) => e.displayName.trim() && e.birthday.trim(),
    ).length;
  }
  return 0;
}

function usesCuratedCap(state: CreateWizardState): boolean {
  return (
    state.candidateSourceMode === "curated" || state.candidateSourceMode === "combined"
  );
}

function usesNominationCap(state: CreateWizardState): boolean {
  return (
    state.candidateSourceMode === "user" || state.candidateSourceMode === "combined"
  );
}

/** True when wizard choices fit within a target plan's per-contest limits. */
export function wizardFitsPlanLimits(
  state: CreateWizardState,
  planId: PlanId,
): boolean {
  return !wizardExceedsPlanLimits(state, planId);
}

/**
 * Whether upgrading to targetPlan would cover this wizard setup and leave an active-contest slot.
 * Pro always has unlimited active contests; Plus/Free are capped.
 */
export function canUpgradePlanForWizard(
  state: CreateWizardState,
  targetPlanId: PlanId,
  activeHostedCount: number,
): boolean {
  if (!wizardFitsPlanLimits(state, targetPlanId)) return false;
  const limits = getPlanLimits(targetPlanId);
  if (limits.maxActiveContests === null) return true;
  return activeHostedCount < limits.maxActiveContests;
}

/** Client or server message when the host cannot create another plan-scoped contest. */
export function activeContestLimitMessage(
  planId: PlanId,
  wizard?: CreateWizardState,
): string {
  const plan = getPlanLimits(planId);
  const max = plan.maxActiveContests;

  if (max === null) {
    return "You've reached your plan's limit for active contests.";
  }

  let message: string;
  if (planId === "free") {
    message = `You've used your ${max} included contest on Free. Finish or delete it, or upgrade to Plus for up to 5 active contests.`;
  } else if (planId === "plus") {
    message = `You've used all ${max} contests included in Plus. Finish or delete one, or upgrade to Pro for unlimited contests.`;
  } else {
    message = `You've used all ${max} contests included in your ${plan.label} plan. Finish or delete one to create another.`;
  }

  if (wizard && wizardExceedsPlanLimits(wizard, planId)) {
    return `${message.replace(/\.$/, "")}, or create with a one-time unlock.`;
  }

  return message;
}

/** True when wizard choices exceed the host account plan (contest unlock required to create). */
export function wizardExceedsPlanLimits(
  state: CreateWizardState,
  planId: PlanId,
): boolean {
  const summary = summarizePlanLimitOverage(state, planId);
  return summary.nominationsPerParticipant || summary.curatedCandidates;
}

export function summarizePlanLimitOverage(
  state: CreateWizardState,
  planId: PlanId,
): PlanLimitOverageSummary {
  const plan = getPlanLimits(planId);
  const nominationPlanMax = plan.maxNominationsPerParticipant;
  const curatedPlanMax = plan.maxCuratedCandidates;
  const participantPlanMax = plan.maxMembers;

  const nominationCount = state.maxNominationsPerParticipant;
  const curatedCount = curatedCandidateCount(state);

  const nominationsPerParticipant =
    usesNominationCap(state) &&
    nominationPlanMax != null &&
    nominationCount > nominationPlanMax;

  const curatedCandidates =
    usesCuratedCap(state) &&
    curatedPlanMax != null &&
    curatedCount > curatedPlanMax;

  return {
    nominationsPerParticipant,
    curatedCandidates,
    nominationCount,
    nominationPlanMax,
    curatedCount,
    curatedPlanMax,
    participantPlanMax,
  };
}

export function candidateSourceFromWizard(
  state: CreateWizardState,
): CandidateSource {
  if (state.candidateSourceMode === "curated") return "curated";
  if (state.candidateSourceMode === "combined") return "combined";
  if (state.maxNominationsPerParticipant > 1) return "user_multiple";
  return "user_single";
}
