import type {
  BallotRevealOrder,
  CandidateReveal,
  CandidateSort,
  CandidateSource,
  ContestTheme,
  ContestTypeId,
  NominationKind,
  NominatorRankingWhen,
  NominatorResultsReveal,
  PlanId,
  ResultsReveal,
  ScoringModelId,
  SongLinksMode,
  VoteMutability,
} from "@/lib/plans";
import {
  CONTEST_TYPE_OPTIONS,
  getPlanLimits,
  parseCandidateSort,
  RESULTS_REVEAL_OPTIONS,
  SCORING_MODELS,
  WIZARD_CANDIDATE_REVEAL_KEYS,
} from "@/lib/plans";

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function newQuestionId(): string {
  return newId("q");
}

export function newAnythingCandidateId(): string {
  return newId("ac");
}

export const CREATE_WIZARD_STORAGE_KEY = "beatage.create-wizard.v4";

export type WizardCandidateSourceMode = "curated" | "user" | "combined";

/** Source picker on Setup (birthday is song-only). */
export type WizardEntrySource = "birthday" | WizardCandidateSourceMode;

export type NominationCloseMode = "manual" | "scheduled" | "duration";

export type QuickPollMode = "pick_one" | "rank";

export type DraftSongCandidate = {
  title: string;
  artist: string;
  previewUrl: string;
};

export type DraftPhotoCandidate = {
  title: string;
  /** Set only in memory for submit — not persisted to localStorage. */
  file?: File | null;
};

export type DraftBirthdayEntry = {
  displayName: string;
  birthday: string;
};

export type WizardQuestion = {
  id: string;
  name: string;
};

/** Curated Anything candidate entered in the wizard (maps to candidates table). */
export type DraftAnythingCandidate = {
  id: string;
  title: string;
  url: string;
  description: string;
  /** Optional attachment (not persisted in localStorage). */
  file: File | null;
};

export function emptyAnythingCandidate(): DraftAnythingCandidate {
  return {
    id: newAnythingCandidateId(),
    title: "",
    url: "",
    description: "",
    file: null,
  };
}

export function cloneAnythingCandidates(
  list: DraftAnythingCandidate[],
): DraftAnythingCandidate[] {
  return list.map((candidate) => ({
    ...candidate,
    id: newAnythingCandidateId(),
    file: null,
  }));
}

export function anythingCandidateHasExtras(
  candidate: DraftAnythingCandidate,
): boolean {
  return Boolean(
    candidate.url.trim() || candidate.description.trim() || candidate.file,
  );
}

export type CreateWizardState = {
  step: number;
  hostName: string;
  title: string;
  description: string;
  contestType: ContestTypeId;
  theme: ContestTheme;
  nominationKind: NominationKind;
  birthdayMode: "participant" | "curated";
  chartCountry: string;
  birthdayOffsetAmount: number;
  birthdayOffsetUnit: "months" | "years";
  questions: WizardQuestion[];
  candidateSourceMode: WizardCandidateSourceMode;
  maxNominationsPerParticipant: number;
  candidateTitle: string;
  hostParticipates: boolean;
  allowDuplicates: boolean;
  candidateReveal: CandidateReveal;
  candidateSort: CandidateSort;
  songLinks: SongLinksMode;
  nominationCloseMode: NominationCloseMode;
  nominationClosesAt: string;
  /** Used when nominationCloseMode is "duration" (1–86400 seconds). */
  nominationDurationSeconds: number;
  /** When true, host enters one base name + count → “Name 1”…“Name N” for all topics. */
  anythingSharedCandidates: boolean;
  /** Base label when anythingSharedCandidates is on → “{base} 1”, “{base} 2”, … */
  anythingSharedBaseName: string;
  draftAnything: DraftAnythingCandidate[];
  /** Per-question candidates when anythingSharedCandidates is false. */
  draftAnythingByQuestion: Record<string, DraftAnythingCandidate[]>;
  draftSongs: DraftSongCandidate[];
  draftPhotos: DraftPhotoCandidate[];
  draftBirthdayEntries: DraftBirthdayEntry[];
  scoringModel: ScoringModelId;
  allowVoteOwnNominations: boolean;
  voteMutability: VoteMutability;
  resultsReveal: ResultsReveal;
  ballotRevealOrder: BallotRevealOrder;
  resultsAnonymous: boolean;
  showStarPoints: boolean;
  /** When true, list who nominated each candidate in the Candidates tab. */
  showNominees: boolean;
  /** Curated only: reveal candidates and open voting right after create. */
  startVotingImmediately: boolean;
  nominatorRanking: boolean;
  nominatorRankingWhen: NominatorRankingWhen;
  nominatorResultsReveal: NominatorResultsReveal;
};

/** Empty title → type-specific default so hosts can leave the field blank. */
export function effectiveContestTitle(
  title: string,
  contestType?: ContestTypeId,
): string {
  const trimmed = title.trim();
  if (trimmed) return trimmed;
  if (contestType === "song") return "My Song Contest";
  if (contestType === "photo") return "My Photo Contest";
  return "My Contest";
}

/** Noun used in participant nomination fields, e.g. "Restaurant 1". */
export const DEFAULT_CANDIDATE_TITLE = "Candidate";

export function effectiveCandidateTitle(title: string | null | undefined): string {
  return title?.trim() || DEFAULT_CANDIDATE_TITLE;
}

export function normalizeCandidateTitleInput(raw: string): string {
  return raw.trim().slice(0, 40);
}

/** Empty topic → default ballot prompt. */
export const DEFAULT_TOPIC_NAME = "Vote one of the following";

export function effectiveTopicName(name: string): string {
  return name.trim() || DEFAULT_TOPIC_NAME;
}

export function defaultWizardState(
  hostName = "",
  _planId: PlanId = "free",
): CreateWizardState {
  return {
    step: 0,
    hostName,
    title: "",
    description: "",
    contestType: "anything",
    theme: "generic",
    nominationKind: "standard",
    birthdayMode: "participant",
    chartCountry: "AT",
    birthdayOffsetAmount: 0,
    birthdayOffsetUnit: "years",
    questions: [{ id: newQuestionId(), name: "" }],
    candidateSourceMode: "curated",
    maxNominationsPerParticipant: 1,
    candidateTitle: "",
    hostParticipates: true,
    allowDuplicates: false,
    candidateReveal: "live",
    candidateSort: "random",
    songLinks: "preview",
    nominationCloseMode: "manual",
    nominationClosesAt: "",
    nominationDurationSeconds: 30 * 60,
    anythingSharedCandidates: false,
    anythingSharedBaseName: "",
    draftAnything: [emptyAnythingCandidate()],
    draftAnythingByQuestion: {},
    draftSongs: [{ title: "", artist: "", previewUrl: "" }],
    draftPhotos: [{ title: "", file: null }],
    draftBirthdayEntries: [
      { displayName: "", birthday: "" },
      { displayName: "", birthday: "" },
    ],
    scoringModel: "linear_x",
    allowVoteOwnNominations: false,
    voteMutability: "editable_until_close",
    resultsReveal: "by_participant",
    ballotRevealOrder: "random",
    resultsAnonymous: false,
    showStarPoints: false,
    showNominees: false,
    startVotingImmediately: false,
    nominatorRanking: true,
    nominatorRankingWhen: "after",
    nominatorResultsReveal: "last_to_first",
  };
}

export function candidateSourceForMode(
  mode: WizardCandidateSourceMode,
  maxNominations: number,
): CandidateSource {
  if (mode === "curated") return "curated";
  if (mode === "combined") return "combined";
  return maxNominations <= 1 ? "user_single" : "user_multiple";
}

export function isAnythingContest(state: CreateWizardState): boolean {
  return state.contestType === "anything" || state.theme === "generic";
}

/** Numbered steps after the type picker (1–4). Step 0 is the type picker. */
export function stepCount(_state: CreateWizardState): number {
  return 4;
}

export function displayStep(state: CreateWizardState): number {
  return Math.max(0, state.step);
}

export function displayStepTotal(state: CreateWizardState): number {
  return stepCount(state);
}

/** Next step index (0 = type picker, 1–4 = numbered flow). */
export function nextStep(state: CreateWizardState): number {
  return Math.min(state.step + 1, 4);
}

export function prevStep(state: CreateWizardState): number {
  return Math.max(0, state.step - 1);
}

/** Current entry-source selection for the Setup picker. */
export function wizardEntrySource(state: CreateWizardState): WizardEntrySource {
  if (state.nominationKind === "birthday") return "birthday";
  return state.candidateSourceMode;
}

/** Apply Birthday / Curated / User / Combined from the Setup source picker. */
export function applyWizardEntrySource(
  state: CreateWizardState,
  source: WizardEntrySource,
): Partial<CreateWizardState> {
  if (source === "birthday") {
    return {
      nominationKind: "birthday",
      birthdayMode: "participant",
      candidateSourceMode: "user",
      maxNominationsPerParticipant: 1,
      nominatorRanking: true,
      allowDuplicates: true,
      candidateReveal: "admin_batch",
      allowVoteOwnNominations: true,
    };
  }
  return {
    nominationKind: "standard",
    candidateSourceMode: source,
    // Curated + leaving Birthday default to Immediately (live).
    candidateReveal:
      source === "curated" || state.nominationKind === "birthday"
        ? "live"
        : coerceWizardCandidateReveal(state.candidateReveal),
    allowDuplicates: false,
    // Host-only / mixed pools have no nominator leaderboard.
    ...(source === "curated" || source === "combined"
      ? { nominatorRanking: false }
      : {}),
  };
}

export function maxQuestionsForPlan(_planId: PlanId): number | null {
  // Contests use a single topic; kept for callers that still import this helper.
  return 1;
}

/** Remaining topic slots — always 0 once a topic exists (single-topic contests). */
export function questionsLeftForPlan(
  _planId: PlanId,
  questionCount: number,
): number | null {
  return Math.max(0, 1 - Math.max(1, questionCount));
}

/** Card title after type is chosen: “New Anything Contest”. */
export function newContestCardTitle(contestType: ContestTypeId): string {
  const option = CONTEST_TYPE_OPTIONS.find((entry) => entry.id === contestType);
  return option ? `New ${option.label}` : "New contest";
}

/** Shared curated list: “Name 1”, “Name 2”, … from a base label.
 * Used by Same Candidate Names (currently UI-disabled; keep for later). */
export function sharedAnythingTitles(baseName: string, count: number): string[] {
  const base = baseName.trim();
  const n = Math.max(1, Math.floor(count));
  return Array.from({ length: n }, (_, index) =>
    base ? `${base} ${index + 1}` : "",
  );
}

/** Resize/rename the shared draftAnything list from count + base name. */
export function syncSharedAnythingDraft(
  existing: DraftAnythingCandidate[],
  count: number,
  baseName: string,
): DraftAnythingCandidate[] {
  const titles = sharedAnythingTitles(baseName, count);
  return titles.map((title, index) => {
    const prev = existing[index];
    return {
      id: prev?.id ?? newAnythingCandidateId(),
      title,
      url: prev?.url ?? "",
      description: prev?.description ?? "",
      file: prev?.file ?? null,
    };
  });
}

export function wizardStepTitle(
  step: number,
  contestType?: ContestTypeId,
  candidateTitle?: string,
): string {
  if (step === 1) return "Setup";
  if (step === 2) {
    if (contestType === "song") return "Song nominations";
    if (contestType === "photo") return "Photo nominations";
    if (contestType === "anything") {
      const noun = effectiveCandidateTitle(candidateTitle);
      return `${noun} nominations`;
    }
    return "Nominations";
  }
  if (step === 3) return "Voting rules";
  if (step === 4) return "Results presentation";
  return "Create";
}

/** Label for the Setup “who nominates” picker. */
export function wizardSourcePickerLabel(
  contestType: ContestTypeId,
  candidateTitle?: string,
): string {
  if (contestType === "song") return "Who nominates songs?";
  if (contestType === "photo") return "Who nominates photos?";
  const noun = effectiveCandidateTitle(candidateTitle).toLowerCase();
  return `Who nominates ${noun}s?`;
}

/** Dynamic help under “When do nominations close?” */
export function nominationCloseModeDescription(
  mode: NominationCloseMode,
): string {
  if (mode === "scheduled") {
    return "Nomination period ends at the exact date and time you set.";
  }
  if (mode === "duration") {
    return "Nominations stay closed until you start them. Then everyone has the window below until nominations close automatically.";
  }
  return "Nomination period ends when the host closes it manually.";
}

/** Plural noun for candidate-reveal copy (songs / photos / …). */
export function wizardCandidateRevealNounPlural(state: CreateWizardState): string {
  if (state.theme === "song") return "songs";
  if (state.theme === "photo") return "photos";
  const title = effectiveCandidateTitle(state.candidateTitle).toLowerCase();
  return title.endsWith("s") ? title : `${title}s`;
}

/** Singular noun for candidate-reveal copy. */
export function wizardCandidateRevealNounSingular(state: CreateWizardState): string {
  if (state.theme === "song") return "song";
  if (state.theme === "photo") return "photo";
  return effectiveCandidateTitle(state.candidateTitle).toLowerCase();
}

/** Question label for “When are … revealed?” */
export function wizardCandidateRevealQuestion(state: CreateWizardState): string {
  const plural = wizardCandidateRevealNounPlural(state);
  return `When are ${plural} revealed?`;
}

type WizardRevealCopy = { label: string; description: string };

/**
 * Labels + descriptions for the three create-wizard reveal modes,
 * tailored to curated / user / combined.
 *
 * Backend mapping (unchanged):
 * - live → candidate status "visible" on create/nominate
 * - admin_batch / admin_sequential → "pending" until the host reveals
 *   (revealing while nominations are open also closes nominations)
 */
export function wizardCandidateRevealOption(
  state: CreateWizardState,
  key: (typeof WIZARD_CANDIDATE_REVEAL_KEYS)[number],
): WizardRevealCopy {
  const mode = state.candidateSourceMode;
  const plural = wizardCandidateRevealNounPlural(state);
  const singular = wizardCandidateRevealNounSingular(state);
  const Plural = plural.charAt(0).toUpperCase() + plural.slice(1);

  if (mode === "curated") {
    if (key === "live") {
      return {
        label: "Immediately",
        description: `All ${plural} are visible immediately after participants join the contest.`,
      };
    }
    if (key === "admin_batch") {
      return {
        label: "Batch reveal (host)",
        description: `All ${plural} will be revealed all at once by the host.`,
      };
    }
    return {
      label: "One after the other (host)",
      description: `${Plural} will be revealed one after the other by the host.`,
    };
  }

  if (mode === "combined") {
    if (key === "live") {
      return {
        label: "All immediately",
        description: `Curated ${plural} are visible immediately when the contest starts; a user-nominated ${singular} becomes visible as soon as it is submitted by a participant.`,
      };
    }
    if (key === "admin_batch") {
      return {
        label: "All batch reveal (host)",
        description: `All curated and user-nominated ${plural} will be revealed all at once by the host after the nomination period ends.`,
      };
    }
    return {
      label: "All one after the other (host)",
      description: `All curated and user-nominated ${plural} will be revealed one after the other by the host after the nomination period ends.`,
    };
  }

  // user nominated
  if (key === "live") {
    return {
      label: "Immediately",
      description: `A ${singular} will be visible as soon as it is submitted by a participant.`,
    };
  }
  if (key === "admin_batch") {
    return {
      label: "Batch reveal (host)",
      description: `All user-nominated ${plural} will be revealed all at once by the host after the nomination period ends.`,
    };
  }
  return {
    label: "One after the other (host)",
    description: `All nominated ${plural} will be revealed one after the other by the host after the nomination period ends.`,
  };
}

/** Coerce legacy / unavailable reveal values to a wizard option. */
export function coerceWizardCandidateReveal(
  reveal: CandidateReveal,
): (typeof WIZARD_CANDIDATE_REVEAL_KEYS)[number] {
  if (reveal === "admin_batch" || reveal === "admin_sequential") return reveal;
  return "live";
}

/** Short labels for the setup source choice (theme-aware). */
export function wizardEntrySourceLabel(state: CreateWizardState): string {
  const source = wizardEntrySource(state);
  if (state.contestType === "song") {
    if (source === "birthday") return "Birthday Song Contest";
    if (source === "curated") return "Curated";
    if (source === "user") return "User nominated";
    return "Combined";
  }
  if (state.contestType === "photo") {
    if (source === "curated") return "Curated";
    if (source === "user") return "User nominated";
    return "Combined";
  }
  const noun = effectiveCandidateTitle(state.candidateTitle);
  if (source === "curated") return `Curated ${noun}s`;
  if (source === "user") return `User nominated ${noun}s`;
  return `Combined ${noun}s`;
}

/**
 * Compact settings trail under the contest title.
 * Grows with each completed step (Setup → Nominations → Voting → Results).
 */
export function wizardSettingsSummaryParts(state: CreateWizardState): string[] {
  if (state.step < 1) return [];

  const parts: string[] = [];

  if (state.step === 1) {
    const typeOption = CONTEST_TYPE_OPTIONS.find(
      (entry) => entry.id === state.contestType,
    );
    parts.push(typeOption?.label ?? "Contest");
  } else {
    parts.push(wizardEntrySourceLabel(state));
  }

  if (state.step >= 2 && state.nominationKind === "birthday") {
    parts.push(
      state.birthdayMode === "curated"
        ? "Host provides birth dates"
        : "Participants provide birth dates",
    );
  }

  if (state.step >= 3) {
    parts.push(SCORING_MODELS[state.scoringModel]?.label ?? state.scoringModel);
  }

  if (state.step >= 4) {
    parts.push(
      RESULTS_REVEAL_OPTIONS[state.resultsReveal]?.label ?? state.resultsReveal,
    );
  }

  return parts;
}

export function wizardSettingsSummary(state: CreateWizardState): string {
  return wizardSettingsSummaryParts(state).join(" · ");
}

/** Placeholder example for the topic field by contest type. */
export function topicPlaceholder(state: CreateWizardState): string {
  if (state.theme === "song") return "Vote your best ever metal song";
  if (state.theme === "photo") return "Vote best 2026 vacation pic";
  return "e.g. Player of the match";
}

/** All contest types use a single topic. */
export function allowsMultipleTopics(_state: CreateWizardState): boolean {
  return false;
}

/**
 * Collapse multi-topic Anything drafts (legacy) into one topic + one candidate list.
 */
export function normalizeWizardToSingleTopic(
  state: CreateWizardState,
): CreateWizardState {
  const first = state.questions[0] ?? { id: newQuestionId(), name: "" };
  if (state.questions.length <= 1 && !Object.keys(state.draftAnythingByQuestion).length) {
    return { ...state, questions: [first] };
  }

  let draftAnything = state.draftAnything;
  const hasFilledShared = draftAnything.some((candidate) => candidate.title.trim());
  if (!hasFilledShared) {
    const perQuestion = state.draftAnythingByQuestion[first.id];
    if (perQuestion?.some((candidate) => candidate.title.trim())) {
      draftAnything = cloneAnythingCandidates(perQuestion);
    } else {
      for (const question of state.questions) {
        const list = state.draftAnythingByQuestion[question.id];
        if (list?.some((candidate) => candidate.title.trim())) {
          draftAnything = cloneAnythingCandidates(list);
          break;
        }
      }
    }
  }

  return {
    ...state,
    questions: [first],
    draftAnything:
      draftAnything.length > 0 ? draftAnything : [emptyAnythingCandidate()],
    draftAnythingByQuestion: {},
    anythingSharedCandidates: false,
    anythingSharedBaseName: "",
  };
}

/** Standard defaults for Quick poll shortcuts from the Candidates step. */
export function anythingUsesSharedCandidates(state: CreateWizardState): boolean {
  return state.anythingSharedCandidates || state.questions.length <= 1;
}

export function ensureDraftAnythingByQuestion(
  state: CreateWizardState,
): CreateWizardState {
  const byQuestion: Record<string, DraftAnythingCandidate[]> = {
    ...state.draftAnythingByQuestion,
  };
  for (const question of state.questions) {
    if (!byQuestion[question.id]?.length) {
      byQuestion[question.id] = [emptyAnythingCandidate()];
    }
  }
  for (const key of Object.keys(byQuestion)) {
    if (!state.questions.some((question) => question.id === key)) {
      delete byQuestion[key];
    }
  }
  return { ...state, draftAnythingByQuestion: byQuestion };
}

export function anythingCandidateRowCount(state: CreateWizardState): number {
  if (!isAnythingContest(state)) return 0;
  if (anythingUsesSharedCandidates(state)) {
    return state.draftAnything.length;
  }
  return state.questions.reduce(
    (sum, question) => sum + (state.draftAnythingByQuestion[question.id]?.length ?? 0),
    0,
  );
}

export function anythingCandidatesForQuestion(
  state: CreateWizardState,
  questionId: string,
): DraftAnythingCandidate[] {
  if (anythingUsesSharedCandidates(state)) {
    return state.draftAnything;
  }
  return state.draftAnythingByQuestion[questionId] ?? [emptyAnythingCandidate()];
}

export function anythingCuratedFilledCount(state: CreateWizardState): number {
  if (!isAnythingContest(state)) return 0;
  if (anythingUsesSharedCandidates(state)) {
    return state.draftAnything.filter((candidate) => candidate.title.trim()).length;
  }
  return state.questions.reduce((sum, question) => {
    const list = state.draftAnythingByQuestion[question.id] ?? [];
    return sum + list.filter((candidate) => candidate.title.trim()).length;
  }, 0);
}

export function applyQuickPollDefaults(
  state: CreateWizardState,
  mode: QuickPollMode,
): CreateWizardState {
  return {
    ...state,
    scoringModel: mode === "pick_one" ? "best_only" : "linear_x",
    allowVoteOwnNominations: false,
    voteMutability: "editable_until_close",
    resultsReveal: "immediate",
    ballotRevealOrder: "random",
    resultsAnonymous: false,
    nominatorRanking: true,
    hostParticipates: true,
    candidateReveal: "live",
    nominationCloseMode: "manual",
    nominationClosesAt: "",
    nominationDurationSeconds: 30 * 60,
    allowDuplicates: false,
    step: 4,
  };
}

export function curatedCandidateCount(state: CreateWizardState): number {
  if (isAnythingContest(state)) {
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
      (e) => e.displayName.trim() && /^\d{4}-\d{2}-\d{2}$/.test(e.birthday),
    ).length;
  }
  return 0;
}

export function serializeWizardState(
  state: CreateWizardState,
): Omit<CreateWizardState, "draftPhotos" | "draftAnything" | "draftAnythingByQuestion"> & {
  draftPhotos: Array<{ title: string }>;
  draftAnything: Array<{
    id: string;
    title: string;
    url: string;
    description: string;
  }>;
  draftAnythingByQuestion: Record<
    string,
    Array<{ id: string; title: string; url: string; description: string }>
  >;
} {
  const { draftPhotos, draftAnything, draftAnythingByQuestion, ...rest } = state;
  const stripAnything = (list: DraftAnythingCandidate[]) =>
    list.map(({ id, title, url, description }) => ({
      id,
      title,
      url,
      description,
    }));
  return {
    ...rest,
    draftPhotos: draftPhotos.map((p) => ({ title: p.title })),
    draftAnything: stripAnything(draftAnything),
    draftAnythingByQuestion: Object.fromEntries(
      Object.entries(draftAnythingByQuestion).map(([key, list]) => [
        key,
        stripAnything(list),
      ]),
    ),
  };
}

export function loadWizardState(
  hostName: string,
  planId: PlanId,
): CreateWizardState {
  if (typeof window === "undefined") {
    return defaultWizardState(hostName, planId);
  }
  try {
    const raw = window.localStorage.getItem(CREATE_WIZARD_STORAGE_KEY);
    if (!raw) return defaultWizardState(hostName, planId);
    const parsed = JSON.parse(raw) as Partial<
      Omit<CreateWizardState, "draftPhotos" | "draftAnything" | "draftAnythingByQuestion"> & {
        draftPhotos: Array<{ title: string }>;
        draftAnything: Array<{
          id?: string;
          title: string;
          url?: string;
          description?: string;
        }>;
        draftAnythingByQuestion: Record<
          string,
          Array<{
            id?: string;
            title: string;
            url?: string;
            description?: string;
          }>
        >;
      }
    >;
    const base = defaultWizardState(hostName, planId);
    const hydrateAnything = (
      list: Array<{
        id?: string;
        title: string;
        url?: string;
        description?: string;
      }>,
    ): DraftAnythingCandidate[] =>
      list.map((row) => ({
        id: row.id && String(row.id).trim() ? String(row.id) : newAnythingCandidateId(),
        title: row.title ?? "",
        url: row.url ?? "",
        description: row.description ?? "",
        file: null,
      }));
    const loaded: CreateWizardState = {
      ...base,
      ...parsed,
      hostName: parsed.hostName?.trim() ? parsed.hostName : hostName,
      candidateSourceMode: parsed.candidateSourceMode ?? "curated",
      draftPhotos: (parsed.draftPhotos ?? base.draftPhotos).map((p) => ({
        title: p.title,
        file: null,
      })),
      draftAnything:
        parsed.draftAnything && parsed.draftAnything.length > 0
          ? hydrateAnything(parsed.draftAnything)
          : base.draftAnything,
      anythingSharedCandidates: false, // Same Candidate Names UI disabled for now
      anythingSharedBaseName: "",
      draftAnythingByQuestion: parsed.draftAnythingByQuestion
        ? Object.fromEntries(
            Object.entries(parsed.draftAnythingByQuestion).map(([key, list]) => [
              key,
              hydrateAnything(list),
            ]),
          )
        : base.draftAnythingByQuestion,
      questions:
        parsed.questions && parsed.questions.length > 0
          ? parsed.questions
          : base.questions,
      showStarPoints: parsed.showStarPoints === true,
      showNominees: parsed.showNominees === true,
      startVotingImmediately: parsed.startVotingImmediately === true,
      candidateSort: parseCandidateSort(
        typeof parsed.candidateSort === "string" ? parsed.candidateSort : undefined,
      ),
    };
    loaded.step = Math.min(Math.max(0, loaded.step ?? 0), 4);
    return normalizeWizardToSingleTopic(ensureDraftAnythingByQuestion(loaded));
  } catch {
    return defaultWizardState(hostName, planId);
  }
}

export function saveWizardState(state: CreateWizardState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CREATE_WIZARD_STORAGE_KEY,
      JSON.stringify(serializeWizardState(state)),
    );
  } catch {
    // ignore quota errors
  }
}

export function clearWizardState(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(CREATE_WIZARD_STORAGE_KEY);
}

/** True when localStorage has a create-wizard draft with real user progress. */
export function hasMeaningfulWizardDraft(
  hostName: string,
  planId: PlanId,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(CREATE_WIZARD_STORAGE_KEY);
    if (!raw) return false;
    const state = loadWizardState(hostName, planId);
    if (state.step > 0) return true;
    if (state.title.trim()) return true;
    if (state.description.trim()) return true;
    if (state.contestType !== "anything") return true;
    if (state.questions.some((question) => question.name.trim())) return true;
    if (
      state.draftAnything.some(
        (row) => row.title.trim() || row.url.trim() || row.description.trim(),
      )
    ) {
      return true;
    }
    if (
      Object.values(state.draftAnythingByQuestion).some((list) =>
        list.some(
          (row) => row.title.trim() || row.url.trim() || row.description.trim(),
        ),
      )
    ) {
      return true;
    }
    if (
      state.draftSongs.some(
        (song) =>
          song.title.trim() || song.artist.trim() || song.previewUrl.trim(),
      )
    ) {
      return true;
    }
    if (state.draftPhotos.some((photo) => photo.title.trim())) return true;
    if (
      state.draftBirthdayEntries.some(
        (entry) => entry.displayName.trim() || entry.birthday.trim(),
      )
    ) {
      return true;
    }
    if (state.candidateTitle.trim()) return true;
    if (state.nominationKind === "birthday") return true;
    if (state.candidateSourceMode !== "curated") return true;
    if (state.scoringModel !== "linear_x") return true;
    if (state.startVotingImmediately) return true;
    return false;
  } catch {
    return false;
  }
}

function minScheduleMs(): number {
  return Date.now() + 60_000;
}

export function validateStep(
  state: CreateWizardState,
  step: number,
  planId: PlanId,
): string | null {
  const plan = getPlanLimits(planId);

  // Step 0 = type picker (advances on click).
  if (step === 0) {
    return null;
  }

  // Step 1 = Setup (title / topic / candidate description / source pick).
  if (step === 1) {
    return null;
  }

  // Step 2 = Source details (curated lists, nominations, birthday options).
  if (step === 2) {
    const curated =
      state.candidateSourceMode === "curated" ||
      state.candidateSourceMode === "combined";
    const candidateNoun = effectiveCandidateTitle(state.candidateTitle).toLowerCase();

    if (curated) {
      if (isAnythingContest(state)) {
        const filled = state.draftAnything.filter((candidate) => candidate.title.trim());
        if (filled.length < 1) {
          return `Please add at least one ${candidateNoun}.`;
        }
        if (state.draftAnything.some((candidate) => !candidate.title.trim())) {
          return `Please fill in every ${candidateNoun} (or remove empty ones).`;
        }
      }

      if (state.theme === "song" && state.nominationKind !== "birthday") {
        if (state.draftSongs.length < 1) {
          return "Please add at least one song.";
        }
        if (state.draftSongs.some((s) => !s.title.trim() || !s.artist.trim())) {
          return "Please complete every song (or remove empty ones).";
        }
      }

      if (state.theme === "photo") {
        if (state.draftPhotos.length < 1) {
          return "Please add at least one photo.";
        }
        if (state.draftPhotos.some((p) => !p.file && !p.title.trim())) {
          return "Please choose a photo for every candidate (or remove empty ones).";
        }
      }

      if (state.nominationKind === "birthday" && state.birthdayMode === "curated") {
        const complete = state.draftBirthdayEntries.filter(
          (e) =>
            e.displayName.trim() && /^\d{4}-\d{2}-\d{2}$/.test(e.birthday),
        );
        const partial = state.draftBirthdayEntries.filter((e) => {
          const hasName = Boolean(e.displayName.trim());
          const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(e.birthday);
          return (hasName || hasDate) && !(hasName && hasDate);
        });
        if (partial.length > 0) {
          return "Each birth date needs a name (and each name needs a birth date).";
        }
        if (complete.length < 2) {
          return "Please add at least two birth dates.";
        }
      }
    }

    if (
      state.candidateSourceMode === "user" ||
      state.candidateSourceMode === "combined"
    ) {
      if (state.maxNominationsPerParticipant < 1) {
        return "Please enter nominations per participant.";
      }

      if (state.nominationCloseMode === "scheduled") {
        if (!state.nominationClosesAt.trim()) {
          return "Please set when nominations close.";
        }
        const ms = Date.parse(state.nominationClosesAt);
        if (!Number.isFinite(ms) || ms < minScheduleMs()) {
          return "Nomination close must be at least 60 seconds from now.";
        }
      }
      if (state.nominationCloseMode === "duration") {
        const secs = state.nominationDurationSeconds;
        if (
          !Number.isFinite(secs) ||
          secs < 1 ||
          secs > 24 * 60 * 60
        ) {
          return "Nomination duration must be between 1 second and 24 hours.";
        }
      }
    }

    return null;
  }

  // Step 3 = Voting rules (host name optional → defaults to "Host").
  if (step === 3) {
    return null;
  }

  // Step 4 = Results presentation.
  if (step === 4) {
    if (state.resultsAnonymous && state.nominatorRanking) {
      return "Anonymous results require nominator ranking to be off.";
    }
    return null;
  }

  return null;
}

/** Named Anything candidate lists saved in the browser for quick rematch setup. */
export const ANYTHING_CANDIDATE_PRESETS_KEY = "beatage.anything-candidate-presets.v1";

export type AnythingCandidatePreset = {
  id: string;
  name: string;
  candidateTitle: string;
  candidates: Array<{ title: string; url: string; description: string }>;
  updatedAt: string;
};

export function listAnythingCandidatePresets(): AnythingCandidatePreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ANYTHING_CANDIDATE_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AnythingCandidatePreset[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry.id === "string" && typeof entry.name === "string")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export function saveAnythingCandidatePreset(input: {
  name: string;
  candidateTitle: string;
  candidates: DraftAnythingCandidate[];
}): AnythingCandidatePreset | null {
  if (typeof window === "undefined") return null;
  const name = input.name.trim().slice(0, 80);
  const candidates = input.candidates
    .filter((candidate) => candidate.title.trim())
    .map((candidate) => ({
      title: candidate.title.trim(),
      url: candidate.url.trim(),
      description: candidate.description.trim(),
    }));
  if (!name || candidates.length < 1) return null;

  const preset: AnythingCandidatePreset = {
    id: newId("preset"),
    name,
    candidateTitle: normalizeCandidateTitleInput(input.candidateTitle),
    candidates,
    updatedAt: new Date().toISOString(),
  };

  try {
    const existing = listAnythingCandidatePresets().filter(
      (entry) => entry.name.toLowerCase() !== name.toLowerCase(),
    );
    window.localStorage.setItem(
      ANYTHING_CANDIDATE_PRESETS_KEY,
      JSON.stringify([preset, ...existing].slice(0, 20)),
    );
    return preset;
  } catch {
    return null;
  }
}

export function applyAnythingCandidatePreset(
  state: CreateWizardState,
  preset: AnythingCandidatePreset,
  mode: "replace" | "append" = "replace",
): CreateWizardState {
  const fromPreset =
    preset.candidates.length > 0
      ? preset.candidates.map((candidate) => ({
          id: newAnythingCandidateId(),
          title: candidate.title,
          url: candidate.url,
          description: candidate.description,
          file: null as File | null,
        }))
      : [emptyAnythingCandidate()];

  if (mode === "append") {
    const existing = state.draftAnything.filter((candidate) =>
      anythingCandidateHasExtras(candidate) || candidate.title.trim(),
    );
    // Prefer filled rows only; drop blank placeholders before appending.
    const draftAnything =
      existing.length > 0 ? [...existing, ...fromPreset] : fromPreset;
    return normalizeWizardToSingleTopic({
      ...state,
      draftAnything,
      draftAnythingByQuestion: {},
    });
  }

  return normalizeWizardToSingleTopic({
    ...state,
    candidateTitle: preset.candidateTitle,
    draftAnything: fromPreset,
    draftAnythingByQuestion: {},
  });
}

/** True when the Anything draft already has at least one real candidate row. */
export function anythingDraftHasFilledCandidates(state: CreateWizardState): boolean {
  return state.draftAnything.some(
    (candidate) =>
      candidate.title.trim() ||
      anythingCandidateHasExtras(candidate),
  );
}

export function deleteAnythingCandidatePreset(presetId: string): void {
  if (typeof window === "undefined") return;
  try {
    const next = listAnythingCandidatePresets().filter((entry) => entry.id !== presetId);
    window.localStorage.setItem(ANYTHING_CANDIDATE_PRESETS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}
