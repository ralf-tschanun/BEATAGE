export type PlanId = "free" | "plus" | "pro";
export type ContestMode = "simple" | "advanced";

export type CandidateSource =
  | "curated"
  | "user_single"
  | "user_multiple"
  | "combined"
  | "databased";

export type CandidateReveal =
  | "live"
  | "admin_batch"
  | "admin_sequential"
  | "after_nominations_close";
export type VoteMutability = "editable_until_close" | "locked_on_submit";
export type VotingCloseMode = "manual" | "scheduled";
export type ContestTheme = "generic" | "song" | "photo";

/** Create-flow type picker. */
export type ContestTypeId = "anything" | "song" | "photo";

export const CONTEST_TYPE_OPTIONS: Array<{
  id: ContestTypeId;
  label: string;
  description: string;
  theme: ContestTheme;
  available: boolean;
}> = [
  {
    id: "song",
    label: "Song Contest",
    description:
      "Nominate songs, invite friends to vote, and present the ranking like Eurovision — including Birthday Song Contests from the charts.",
    theme: "song",
    available: true,
  },
  {
    id: "photo",
    label: "Photo Contest",
    description:
      "Nominate photos from your camera roll, vote for the best shot, and crown the photographer.",
    theme: "photo",
    available: true,
  },
  {
    id: "anything",
    label: "Anything Contest",
    description:
      "One topic, your candidates — Player of the day, Car of the year, Favorite wine, beers, restaurants, movies — with optional links and attachments.",
    theme: "generic",
    available: true,
  },
];

/** Intro copy above the create-flow type picker. */
export const CREATE_CONTEST_TYPE_INTRO =
  "Create your own contest: nominate songs, photos, or any other topic — like Player of the day, Car of the year, or Favorite wine — and invite friends to vote. After voting, present the results like the Eurovision Song Contest — with options that make finding out who won exciting.";
export type ResultsReveal =
  | "live"
  | "immediate"
  | "last_to_first"
  | "by_participant";
/** How nominator ranking is revealed (independent of candidate results_reveal). */
export type NominatorResultsReveal =
  | "immediate"
  | "last_to_first"
  | "first_to_last";
/** Order of ballots when results_reveal = by_participant. */
export type BallotRevealOrder =
  | "alphabetical"
  | "first_submitted"
  | "last_submitted"
  | "random";
export type NominatorRankingWhen = "before" | "after" | "parallel";
export type ResultsPhase = "nominators" | "candidates" | "done";
export type CandidateSort =
  | "as_entered"
  | "nominated_at"
  | "alphabetical"
  | "random";

/** Full ranking without manual reveal steps (immediate after close, or live during voting). */
export function isInstantResultsReveal(mode: ResultsReveal | string): boolean {
  return mode === "immediate" || mode === "live";
}
export type NominationKind = "standard" | "birthday";

/** How song contests expose audio links to participants (host always gets Spotify when available). */
export type SongLinksMode = "preview" | "spotify" | "none";

export const SONG_LINKS_OPTIONS: Record<
  SongLinksMode,
  { label: string; description: string }
> = {
  preview: {
    label: "Previews only",
    description:
      "Participants see a preview clip. Only the host has a Spotify link to open the full track.",
  },
  spotify: {
    label: "Preview and Spotify link",
    description:
      "Everyone gets the short preview clip plus a Spotify logo to open the full track.",
  },
  none: {
    label: "None",
    description: "No preview clips for anyone. Only the host sees the Spotify logo.",
  },
};

export function parseSongLinksMode(value: unknown): SongLinksMode {
  if (value === "spotify" || value === "none" || value === "preview") return value;
  return "preview";
}

/** Host-curated birthday: entries with name + date, chart lookup on reveal. */
export function isCuratedBirthdayContest(
  nominationKind: NominationKind,
  candidateSource: CandidateSource,
): boolean {
  return nominationKind === "birthday" && candidateSource === "curated";
}

export type ScoringModelId =
  | "best_only"
  | "linear_x"
  | "star_rating"
  | "linear2"
  | "linear3"
  | "linear5"
  | "linear12"
  | "dyn4"
  | "dyn6"
  | "dyn10";

export const STAR_RATING_MAX = 5;

export function isStarRatingModel(model: ScoringModelId | string): boolean {
  return model === "star_rating";
}

export function isBestOnlyModel(model: ScoringModelId | string): boolean {
  return model === "best_only";
}

/** Voting happens on the candidates list (stars or single trophy). */
export function isInlineVoteModel(model: ScoringModelId | string): boolean {
  return isStarRatingModel(model) || isBestOnlyModel(model);
}

/** Clamp a star rating to 0–5 integer. */
export function clampStarRating(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(STAR_RATING_MAX, Math.round(n)));
}

export function parseStarRatings(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key) continue;
    out[key] = clampStarRating(value);
  }
  return out;
}

/**
 * Ballots for a topic: prefer question-scoped rows, otherwise unscoped
 * (song/photo seeds often have a topic but candidates/ballots with null question_id).
 */
export function ballotsForQuestion<T extends { questionId?: string | null }>(
  ballots: T[],
  questionId: string,
): T[] {
  const scoped = ballots.filter((ballot) => ballot.questionId === questionId);
  if (scoped.length > 0) return scoped;
  return ballots.filter((ballot) => !ballot.questionId);
}

export type PlanLimits = {
  id: PlanId;
  label: string;
  /** null = unlimited */
  maxActiveContests: number | null;
  /** null = unlimited */
  maxMembers: number | null;
  mode: ContestMode;
  /** inactivity expiry; null = no auto-expiry */
  inactivityExpiryDays: number | null;
  /** curated candidate cap; null = unlimited */
  maxCuratedCandidates: number | null;
  /** user_multiple nominations per participant; null = unlimited */
  maxNominationsPerParticipant: number | null;
};

export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    id: "free",
    label: "Free",
    maxActiveContests: 1,
    maxMembers: 10,
    mode: "simple",
    inactivityExpiryDays: 7,
    maxCuratedCandidates: 10,
    maxNominationsPerParticipant: 2,
  },
  plus: {
    id: "plus",
    label: "Plus",
    maxActiveContests: 5,
    maxMembers: 20,
    mode: "advanced",
    inactivityExpiryDays: 183,
    maxCuratedCandidates: 50,
    maxNominationsPerParticipant: 5,
  },
  pro: {
    id: "pro",
    label: "Pro",
    maxActiveContests: null,
    maxMembers: null,
    mode: "advanced",
    inactivityExpiryDays: null,
    maxCuratedCandidates: null,
    maxNominationsPerParticipant: null,
  },
};

export const ACTIVE_CONTEST_STATUSES = ["draft", "open", "voting"] as const;

export const CANDIDATE_SOURCES: Record<
  CandidateSource,
  { label: string; description: string }
> = {
  curated: {
    label: "Curated",
    description: "Only the host adds candidates.",
  },
  user_single: {
    label: "User nominated (1 each)",
    description: "Each participant nominates one candidate.",
  },
  user_multiple: {
    label: "User multiple nominations",
    description: "Participants may nominate several candidates (host sets the max).",
  },
  combined: {
    label: "Combined",
    description:
      "Host curates some candidates; participants can nominate more. All appear in voting.",
  },
  databased: {
    label: "Databased",
    description: "Structured fields (birthday, place, photo, link, …). Submission UI later.",
  },
};

export const CANDIDATE_REVEALS: Record<
  CandidateReveal,
  { label: string; description: string }
> = {
  live: {
    label: "Immediately",
    description:
      "Candidates become visible right away (as soon as they are available or submitted).",
  },
  after_nominations_close: {
    label: "At nomination close",
    description:
      "All candidates become visible automatically as soon as nominations close (manual, scheduled, or timed window).",
  },
  admin_batch: {
    label: "Batch reveal (host)",
    description:
      "All candidates are revealed at once by the host. Releasing closes nominations when they are still open.",
  },
  admin_sequential: {
    label: "One after the other (host)",
    description:
      "The host reveals candidates one after another. The first reveal closes nominations when they are still open.",
  },
};

/** Create-wizard options (excludes “at nomination close”). */
export const WIZARD_CANDIDATE_REVEAL_KEYS = [
  "live",
  "admin_batch",
  "admin_sequential",
] as const satisfies readonly CandidateReveal[];

/** Host must manually reveal candidates (batch or one-by-one). */
export function isAdminCandidateReveal(reveal: CandidateReveal): boolean {
  return reveal === "admin_batch" || reveal === "admin_sequential";
}

/** Candidates stay hidden from others until a reveal step (admin or nominations close). */
export function isDeferredCandidateReveal(reveal: CandidateReveal): boolean {
  return isAdminCandidateReveal(reveal) || reveal === "after_nominations_close";
}

export function parseCandidateReveal(raw: string | null | undefined): CandidateReveal {
  if (
    raw === "admin_batch" ||
    raw === "admin_sequential" ||
    raw === "after_nominations_close" ||
    raw === "live"
  ) {
    return raw;
  }
  return "live";
}

export const RESULTS_REVEAL_OPTIONS: Record<
  ResultsReveal,
  { label: string; description: string }
> = {
  live: {
    label: "Live",
    description:
      "Show the ranking as soon as ballots exist and update it live during voting. No manual reveal steps.",
  },
  immediate: {
    label: "All at once (host)",
    description:
      "After voting ends, the host shows the full ranking with ranks and points right away.",
  },
  last_to_first: {
    label: "Last to first (host)",
    description:
      "Host reveals one place at a time from last to first. Lower ranks slide down until #1 is on top — EXCITING!",
  },
  by_participant: {
    label: "Ballot by ballot (host)",
    description:
      "Host reveals votes one participant at a time. Rank and points recalculate after each ballot. Choose the reveal order below.",
  },
};

export const NOMINATOR_RESULTS_REVEAL_OPTIONS: Record<
  NominatorResultsReveal,
  { label: string; description: string }
> = {
  immediate: {
    label: "All at once (host)",
    description: "All nominator ranks are presented together when that phase starts.",
  },
  last_to_first: {
    label: "Last to first (host)",
    description:
      "Reveal one place at a time from last up to first — the winner is presented last. EXCITING!",
  },
  first_to_last: {
    label: "First to last (host)",
    description:
      "Reveal one place at a time from first down to last — the winner is presented first.",
  },
};

/** Wizard UI: stepped first-to-last is available in DB but hidden from create for now. */
export const WIZARD_NOMINATOR_RESULTS_REVEAL_KEYS: NominatorResultsReveal[] = [
  "immediate",
  "last_to_first",
];

/** Parse DB / form value; unknown values fall back to immediate. */
export function parseNominatorResultsReveal(
  raw: string | null | undefined,
): NominatorResultsReveal {
  if (raw === "last_to_first" || raw === "first_to_last" || raw === "immediate") {
    return raw;
  }
  return "immediate";
}

export const BALLOT_REVEAL_ORDER_OPTIONS: Record<
  BallotRevealOrder,
  { label: string; description: string }
> = {
  alphabetical: {
    label: "Alphabetical",
    description: "Reveal ballots in A–Z order of participant names.",
  },
  first_submitted: {
    label: "First submitted",
    description: "Reveal ballots in the order they were submitted (earliest first).",
  },
  last_submitted: {
    label: "Last submitted",
    description: "Reveal ballots in reverse submission order (latest first).",
  },
  random: {
    label: "Random",
    description: "Reveal ballots in a fixed random order for this contest.",
  },
};

export const NOMINATOR_RANKING_WHEN_OPTIONS: Record<
  NominatorRankingWhen,
  { label: string; description: string }
> = {
  before: {
    label: "Before",
    description:
      "Present the nominator ranking before showing the candidate results.",
  },
  after: {
    label: "After",
    description:
      "Present the nominator ranking after showing the candidate results.",
  },
  parallel: {
    label: "Parallel",
    description:
      "As each candidate place is revealed, add those points to their nominator so the nominator ranking updates live.",
  },
};

export const CANDIDATE_SORT_OPTIONS: Record<
  Exclude<CandidateSort, "nominated_at">,
  { label: string; description: string }
> = {
  as_entered: {
    label: "As entered",
    description:
      "Keep the order candidates were entered or nominated (including curated lists).",
  },
  alphabetical: {
    label: "Alphabetical",
    description: "Sorted by Candidates Title",
  },
  random: {
    label: "Random",
    description:
      "Shuffle candidates. The order is reshuffled whenever a new candidate is added.",
  },
};

/** Map legacy nominated_at to as_entered; keep other known modes. */
export function parseCandidateSort(raw: string | null | undefined): CandidateSort {
  if (raw === "alphabetical" || raw === "random" || raw === "as_entered") {
    return raw;
  }
  // nominated_at removed from UI — treat as as_entered going forward
  return "as_entered";
}

export const VOTE_MUTABILITY_OPTIONS: Record<
  VoteMutability,
  { label: string; description: string }
> = {
  editable_until_close: {
    label: "Editable until close",
    description: "Participants can change their votes until voting ends.",
  },
  locked_on_submit: {
    label: "Locked on submit",
    description: "Once submitted, a vote cannot be changed.",
  },
};

export const SCORING_MODELS: Record<
  ScoringModelId,
  { label: string; points: number[]; description: string }
> = {
  best_only: {
    label: "Best only",
    points: [1],
    description:
      "Each participant picks one favorite candidate. That choice scores 1 point.",
  },
  linear_x: {
    label: "Rate all",
    points: [],
    description:
      "Participants rank all candidates. With N on the ballot, 1st gets N points, 2nd gets N−1, down to 1 for last.",
  },
  star_rating: {
    label: "★★★★★ Rating",
    points: [],
    description:
      "Participants rate each candidate with stars. Rankings use average ratings (ties broken as needed).",
  },
  linear2: {
    label: "Best 2",
    points: [2, 1],
    description: "Participants rank their top 2. Points: 2 for 1st, 1 for 2nd.",
  },
  linear3: {
    label: "Best 3",
    points: [3, 2, 1],
    description: "Participants rank their top 3. Points: 3, 2, 1.",
  },
  linear5: {
    label: "Best 5",
    points: [5, 4, 3, 2, 1],
    description: "Participants rank their top 5. Points: 5, 4, 3, 2, 1.",
  },
  linear12: {
    label: "Best 12",
    points: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
    description: "Participants rank their top 12. Points: 12 down to 1.",
  },
  dyn4: {
    label: "Dynamic 4",
    points: [10, 6, 3, 1],
    description: "Participants rank their top 4. Points: 10, 6, 3, 1.",
  },
  dyn6: {
    label: "Dynamic 6",
    points: [25, 15, 8, 4, 2, 1],
    description: "Participants rank their top 6. Points: 25, 15, 8, 4, 2, 1.",
  },
  dyn10: {
    label: "Dynamic 10",
    points: [46, 37, 29, 22, 16, 11, 7, 4, 2, 1],
    description:
      "Participants rank their top 10. Points: 46, 37, 29, 22, 16, 11, 7, 4, 2, 1.",
  },
};

export const CONTEST_THEMES: Record<
  ContestTheme,
  { label: string; description: string }
> = {
  generic: {
    label: "Anything Contest",
    description: "Any candidates — title, optional link and note.",
  },
  song: {
    label: "Song Contest",
    description:
      "Nominate songs with title + artist. Search uses the free iTunes catalog and stores a short preview clip (no Apple ID needed to listen).",
  },
  photo: {
    label: "Photo Contest",
    description:
      "Nominate photos from your camera roll. Vote for the best shot — and crown the photographer.",
  },
};

/** Human-readable contest type for badges (dashboard, contest header). */
export function contestTypeLabel(input: {
  theme?: string | null;
  nominationKind?: string | null;
}): string {
  const theme = (input.theme ?? "generic") as ContestTheme;
  if (input.nominationKind === "birthday") {
    return "Birthday Song Contest";
  }
  return CONTEST_THEMES[theme]?.label ?? "Anything Contest";
}

export function contestTypeIdFromTheme(theme: ContestTheme): ContestTypeId {
  if (theme === "song") return "song";
  if (theme === "photo") return "photo";
  return "anything";
}

export const DEFAULT_CONTEST_SETTINGS = {
  theme: "generic" as ContestTheme,
  candidateSource: "user_single" as CandidateSource,
  maxNominationsPerParticipant: 1,
  allowDuplicateCandidates: false,
  hostParticipates: true,
  nominationDeadline: "",
  candidateReveal: "admin_batch" as CandidateReveal,
  voteMutability: "editable_until_close" as VoteMutability,
  votingCloseMode: "manual" as VotingCloseMode,
  votingClosesAt: "",
  scoringModel: "linear_x" as ScoringModelId,
  resultsReveal: "by_participant" as ResultsReveal,
  ballotRevealOrder: "random" as BallotRevealOrder,
  nominatorRanking: true as boolean,
  nominatorRankingWhen: "after" as NominatorRankingWhen,
  nominatorResultsReveal: "last_to_first" as NominatorResultsReveal,
  candidateSort: "random" as CandidateSort,
  allowVoteOwnNominations: false,
  nominationKind: "standard" as NominationKind,
  chartCountry: "AT" as const,
  songLinks: "preview" as SongLinksMode,
  candidateTitle: "",
  showStarPoints: false,
  showNominees: false,
};

export function getPlanLimits(plan: PlanId = "free"): PlanLimits {
  return PLANS[plan] ?? PLANS.free;
}

export function clampNominationsForPlan(
  plan: PlanId,
  requested: number,
  source: CandidateSource,
): number {
  if (source === "user_single" || source === "curated" || source === "databased") {
    return 1;
  }
  const cap = getPlanLimits(plan).maxNominationsPerParticipant;
  const value = Math.max(1, Math.floor(requested || 1));
  if (cap === null) return value;
  return Math.min(value, cap);
}

/** Label for anonymous ballot-by-ballot presentation (1-based). */
export function anonymousParticipantLabel(index: number): string {
  return `Participant ${Math.max(1, index + 1)}`;
}

/**
 * Nominator ranking needs participant (or birthday) nominators.
 * Curated / combined host pools have no meaningful nominator leaderboard —
 * except birthday contests, which rank by birthday person.
 */
export function allowsNominatorRanking(
  source: CandidateSource,
  nominationKind: NominationKind = "standard",
): boolean {
  if (nominationKind === "birthday") return true;
  return source !== "curated" && source !== "combined";
}

/**
 * Whether a candidate counts toward a participant's nomination quota.
 * Curated/host-seeded entries in combined contests do not.
 */
export function isParticipantNomination(
  candidate: {
    nominator_user_id?: string | null;
    meta?: Record<string, unknown> | null;
  },
  source: CandidateSource,
  hostUserId: string | null | undefined,
): boolean {
  const origin = candidate.meta?.nomination_origin;
  if (origin === "curated") return false;
  if (origin === "user") return true;
  // Legacy combined: host-nominated rows without a flag were curated seeds.
  if (
    source === "combined" &&
    hostUserId &&
    candidate.nominator_user_id === hostUserId
  ) {
    return false;
  }
  if (source === "curated") return false;
  return true;
}

/**
 * Own-nomination voting ban applies only to participant nominations,
 * not curated/host-seeded pool entries.
 */
export function isExcludedOwnNomination(
  candidate: {
    nominator_user_id?: string | null;
    meta?: Record<string, unknown> | null;
  },
  voterUserId: string,
  source: CandidateSource,
  hostUserId: string | null | undefined,
): boolean {
  if (candidate.nominator_user_id !== voterUserId) return false;
  return isParticipantNomination(candidate, source, hostUserId);
}

/** Nominator keys that count toward nominator ranking (participant nominations only). */
export function resolveNominatorRankingKeys(
  candidate: {
    nominatorUserId?: string | null;
    nominatorUserIds?: string[];
    nominatorKeys?: string[];
    meta?: Record<string, unknown> | null;
  },
  context: {
    candidateSource: CandidateSource;
    hostUserId: string | null | undefined;
  },
): string[] {
  if (candidate.nominatorKeys && candidate.nominatorKeys.length > 0) {
    return candidate.nominatorKeys;
  }

  const userIds =
    candidate.nominatorUserIds && candidate.nominatorUserIds.length > 0
      ? candidate.nominatorUserIds
      : candidate.nominatorUserId
        ? [candidate.nominatorUserId]
        : [];

  return userIds.filter((userId) =>
    isParticipantNomination(
      { nominator_user_id: userId, meta: candidate.meta ?? null },
      context.candidateSource,
      context.hostUserId,
    ),
  );
}

/** Point ladder for a model given the current candidate pool size. */
export function scoringPointsForPool(
  model: ScoringModelId,
  candidateCount: number,
): number[] {
  if (model === "star_rating") return [];
  if (model === "linear_x") {
    const n = Math.max(0, candidateCount);
    return Array.from({ length: n }, (_, index) => n - index);
  }
  return SCORING_MODELS[model]?.points ?? SCORING_MODELS.best_only.points;
}

/** How many ranked picks a ballot needs for this model and candidate pool. */
export function getBallotSlotCount(
  model: ScoringModelId,
  candidateCount: number,
): number {
  if (isStarRatingModel(model)) return 0;
  const points = scoringPointsForPool(model, candidateCount);
  return Math.min(points.length, Math.max(0, candidateCount));
}

/**
 * Best 2–4 (and dyn4): pick ranks on each candidate row (#1…#4), submit below.
 */
export function isInlineRankChipsModel(
  model: ScoringModelId | string,
  candidateCount: number,
): boolean {
  if (isStarRatingModel(model) || isBestOnlyModel(model)) return false;
  const slots = getBallotSlotCount(model as ScoringModelId, candidateCount);
  return slots >= 2 && slots <= 4;
}

/**
 * Best 5+ / long ballots: show Your ballot above the candidates list.
 */
export function isEmbeddedBallotModel(
  model: ScoringModelId | string,
  candidateCount: number,
): boolean {
  if (isStarRatingModel(model) || isBestOnlyModel(model)) return false;
  if (isInlineRankChipsModel(model, candidateCount)) return false;
  return getBallotSlotCount(model as ScoringModelId, candidateCount) >= 5;
}

/** Ranking ballot models (not stars / best-only trophy). */
export function isRankingBallotModel(model: ScoringModelId | string): boolean {
  return !isStarRatingModel(model) && !isBestOnlyModel(model);
}

/** Sort candidates for lists, ballots, and reveals. */
export function sortCandidates<
  T extends {
    title: string;
    artist?: string | null;
    created_at?: string | null;
    display_order?: number | null;
  },
>(rows: T[], mode: CandidateSort): T[] {
  const copy = [...rows];
  if (mode === "alphabetical") {
    return copy.sort((a, b) => {
      const keyA = `${a.title}\0${a.artist ?? ""}`.toLocaleLowerCase();
      const keyB = `${b.title}\0${b.artist ?? ""}`.toLocaleLowerCase();
      return keyA.localeCompare(keyB);
    });
  }
  if (mode === "random" || mode === "as_entered") {
    return copy.sort((a, b) => {
      const orderA = a.display_order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.display_order ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      const timeA = a.created_at ? Date.parse(a.created_at) : 0;
      const timeB = b.created_at ? Date.parse(b.created_at) : 0;
      if (timeA !== timeB) return timeA - timeB;
      return a.title.localeCompare(b.title);
    });
  }
  // Legacy nominated_at (and unknown): chronological by created_at
  return copy.sort((a, b) => {
    const timeA = a.created_at ? Date.parse(a.created_at) : 0;
    const timeB = b.created_at ? Date.parse(b.created_at) : 0;
    if (timeA !== timeB) return timeA - timeB;
    return a.title.localeCompare(b.title);
  });
}

/** 1-based rank position → points for the scoring model. */
export function pointsForRank(
  model: ScoringModelId,
  rankPosition: number,
  candidateCount = 0,
): number {
  const points = scoringPointsForPool(model, candidateCount);
  return points[rankPosition - 1] ?? 0;
}

/**
 * Pool size used to turn rank → points for one ballot.
 * Rate all (`linear_x`) must use the eligible ranking length (own nominations
 * excluded), not the full in-voting candidate count — otherwise 1st place is
 * over-scored (e.g. 5 pts when only 3 were on the ballot).
 */
export function scoringPoolSizeForBallot(
  model: ScoringModelId,
  rankingsLength: number,
  candidateCount: number,
): number {
  if (model === "linear_x") {
    return Math.max(0, rankingsLength);
  }
  return Math.max(0, candidateCount);
}

export type BallotScoreInput = {
  rankings: string[];
  ratings?: Record<string, number> | null;
};

/** Points each candidate receives from a single ballot ranking or star rating. */
export function pointsByCandidateFromBallot(
  model: ScoringModelId,
  rankings: string[],
  candidateCount = rankings.length,
  ratings?: Record<string, number> | null,
): Record<string, number> {
  if (isStarRatingModel(model)) {
    const out: Record<string, number> = {};
    for (const [candidateId, stars] of Object.entries(ratings ?? {})) {
      const n = clampStarRating(stars);
      if (n > 0) out[candidateId] = n;
    }
    return out;
  }
  const poolSize = scoringPoolSizeForBallot(
    model,
    rankings.length,
    candidateCount,
  );
  const out: Record<string, number> = {};
  rankings.forEach((candidateId, index) => {
    const pts = pointsForRank(model, index + 1, poolSize);
    if (pts > 0) {
      out[candidateId] = pts;
    }
  });
  return out;
}

export type ResultRow = {
  candidateId: string;
  title: string;
  artist: string | null;
  url: string | null;
  points: number;
  rank: number;
  /** Star rating: average stars (0–5) from ballots that rated this candidate. */
  starAverage?: number;
};

export function computeResults(
  model: ScoringModelId,
  candidates: Array<{
    id: string;
    title: string;
    artist?: string | null;
    url?: string | null;
  }>,
  ballots: BallotScoreInput[],
): ResultRow[] {
  const totals = new Map<string, number>();
  const raterCounts = new Map<string, number>();
  for (const candidate of candidates) {
    totals.set(candidate.id, 0);
    raterCounts.set(candidate.id, 0);
  }

  for (const ballot of ballots) {
    if (isStarRatingModel(model)) {
      const ratings = ballot.ratings ?? {};
      for (const [candidateId, stars] of Object.entries(ratings)) {
        if (!totals.has(candidateId)) continue;
        totals.set(
          candidateId,
          (totals.get(candidateId) ?? 0) + clampStarRating(stars),
        );
        raterCounts.set(candidateId, (raterCounts.get(candidateId) ?? 0) + 1);
      }
      continue;
    }
    ballot.rankings.forEach((candidateId, index) => {
      if (!totals.has(candidateId)) return;
      const poolSize = scoringPoolSizeForBallot(
        model,
        ballot.rankings.length,
        candidates.length,
      );
      totals.set(
        candidateId,
        (totals.get(candidateId) ?? 0) +
          pointsForRank(model, index + 1, poolSize),
      );
    });
  }

  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const sorted = [...totals.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    const titleA = byId.get(a[0])?.title ?? "";
    const titleB = byId.get(b[0])?.title ?? "";
    return titleA.localeCompare(titleB);
  });

  // Competition ranking (1224): tied points share a place; the next place is skipped.
  let lastPoints: number | null = null;
  let lastRank = 0;
  return sorted.map(([candidateId, points], index) => {
    const candidate = byId.get(candidateId);
    const rank = lastPoints === points ? lastRank : index + 1;
    lastPoints = points;
    lastRank = rank;
    const raters = raterCounts.get(candidateId) ?? 0;
    return {
      candidateId,
      title: candidate?.title ?? "Unknown",
      artist: candidate?.artist ?? null,
      url: candidate?.url ?? null,
      points,
      rank,
      ...(isStarRatingModel(model)
        ? { starAverage: raters > 0 ? points / raters : 0 }
        : {}),
    };
  });
}

export type NominatorResultRow = {
  /** Stable key: user uuid or `entry:{uuid}` for curated birthday. */
  nominatorKey: string;
  displayName: string;
  points: number;
  rank: number;
  candidateCount: number;
  candidateTotal: number;
};

/** Sum candidate points per nominator; competition ranking (1224). */
export function computeNominatorResults(
  candidateResults: ResultRow[],
  candidates: Array<{
    id: string;
    nominatorUserId: string | null;
    nominatorUserIds?: string[];
    /** Curated birthday: `entry:{uuid}` keys per linked entry. */
    nominatorKeys?: string[];
    meta?: Record<string, unknown> | null;
  }>,
  nameByKey: Record<string, string>,
  context: {
    candidateSource: CandidateSource;
    hostUserId: string | null | undefined;
  },
): NominatorResultRow[] {
  const nominatorsByCandidate = new Map<string, string[]>();
  for (const candidate of candidates) {
    const keys = resolveNominatorRankingKeys(
      {
        nominatorUserId: candidate.nominatorUserId,
        nominatorUserIds: candidate.nominatorUserIds,
        nominatorKeys: candidate.nominatorKeys,
        meta: candidate.meta,
      },
      context,
    );
    nominatorsByCandidate.set(candidate.id, keys);
  }
  const totalByNominator = new Map<string, number>();
  for (const candidate of candidates) {
    const keys = nominatorsByCandidate.get(candidate.id) ?? [];
    for (const key of keys) {
      totalByNominator.set(key, (totalByNominator.get(key) ?? 0) + 1);
    }
  }
  const totals = new Map<string, { points: number; candidateCount: number }>();

  for (const row of candidateResults) {
    const keys = nominatorsByCandidate.get(row.candidateId) ?? [];
    for (const key of keys) {
      const prev = totals.get(key) ?? { points: 0, candidateCount: 0 };
      totals.set(key, {
        points: prev.points + row.points,
        candidateCount: prev.candidateCount + (row.points > 0 ? 1 : 0),
      });
    }
  }

  const sorted = [...totals.entries()].sort((a, b) => {
    if (b[1].points !== a[1].points) return b[1].points - a[1].points;
    const nameA = nameByKey[a[0]] ?? "";
    const nameB = nameByKey[b[0]] ?? "";
    return nameA.localeCompare(nameB);
  });

  let lastPoints: number | null = null;
  let lastRank = 0;
  return sorted.map(([nominatorKey, stats], index) => {
    const rank = lastPoints === stats.points ? lastRank : index + 1;
    lastPoints = stats.points;
    lastRank = rank;
    return {
      nominatorKey,
      displayName: nameByKey[nominatorKey] ?? "Unknown",
      points: stats.points,
      rank,
      candidateCount: stats.candidateCount,
      candidateTotal: totalByNominator.get(nominatorKey) ?? stats.candidateCount,
    };
  });
}

/** How nominator ranking is revealed (parallel always shows immediately). */
export function nominatorRevealMode(
  nominatorResultsReveal: NominatorResultsReveal,
  nominatorRankingWhen: NominatorRankingWhen,
): NominatorResultsReveal {
  if (nominatorRankingWhen === "parallel") return "immediate";
  return nominatorResultsReveal;
}

/** Stepped place-by-place reveal (not instant, not ballot-by-ballot). */
export function isSteppedPlaceReveal(
  mode: ResultsReveal | NominatorResultsReveal | string,
): boolean {
  return mode === "last_to_first" || mode === "first_to_last";
}

/** Eligible voters (participants + host if participating). */
export function eligibleVotersInOrder<
  T extends { userId: string; role: string; joinedAt?: string | null },
>(members: T[], hostParticipates: boolean): T[] {
  return members.filter((member) => {
    if (member.role === "participant") return true;
    if (member.role === "host") return hostParticipates;
    return false;
  });
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: T[], seed: string): T[] {
  const out = [...items];
  const rand = mulberry32(hashSeed(seed));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/**
 * Eligible voters ordered for ballot-by-ballot results reveal.
 * People without a ballot are placed after those who submitted.
 */
export function orderVotersForBallotReveal<
  T extends {
    userId: string;
    role: string;
    displayName?: string;
    joinedAt?: string;
  },
>(
  members: T[],
  hostParticipates: boolean,
  order: BallotRevealOrder,
  options: {
    submittedAtByUserId?: Record<string, string | null | undefined>;
    /** Stable random seed (use contest id). */
    seed?: string;
  } = {},
): T[] {
  const eligible = eligibleVotersInOrder(members, hostParticipates);
  const submittedAtByUserId = options.submittedAtByUserId ?? {};

  const decorated = eligible.map((member, index) => {
    const raw = submittedAtByUserId[member.userId];
    const submittedMs = raw ? new Date(raw).getTime() : NaN;
    return {
      member,
      index,
      name: (member.displayName ?? "").toLocaleLowerCase(),
      submittedMs: Number.isFinite(submittedMs) ? submittedMs : null,
    };
  });

  if (order === "alphabetical") {
    decorated.sort(
      (a, b) => a.name.localeCompare(b.name) || a.index - b.index,
    );
  } else if (order === "first_submitted") {
    decorated.sort((a, b) => {
      if (a.submittedMs == null && b.submittedMs == null) return a.index - b.index;
      if (a.submittedMs == null) return 1;
      if (b.submittedMs == null) return -1;
      return a.submittedMs - b.submittedMs || a.index - b.index;
    });
  } else if (order === "last_submitted") {
    decorated.sort((a, b) => {
      if (a.submittedMs == null && b.submittedMs == null) return a.index - b.index;
      if (a.submittedMs == null) return 1;
      if (b.submittedMs == null) return -1;
      return b.submittedMs - a.submittedMs || a.index - b.index;
    });
  } else {
    const shuffled = seededShuffle(decorated, options.seed ?? "ballot-reveal");
    return shuffled.map((row) => row.member);
  }

  return decorated.map((row) => row.member);
}

/**
 * Apply staged results reveal.
 * - immediate / live: full list
 * - last_to_first: bottom `step` rows of the full ranking
 * - first_to_last: top `step` rows of the full ranking
 * - by_participant: `fullResults` should already be scored from the first `step` ballots
 */
export function applyResultsReveal<T>(
  mode: ResultsReveal | NominatorResultsReveal,
  step: number,
  fullResults: T[],
): T[] {
  if (isInstantResultsReveal(mode)) return fullResults;
  if (step <= 0) return [];
  if (mode === "last_to_first") {
    return fullResults.slice(Math.max(0, fullResults.length - step));
  }
  if (mode === "first_to_last") {
    return fullResults.slice(0, Math.min(step, fullResults.length));
  }
  return fullResults;
}

export function resultsRevealMaxStep(
  mode: ResultsReveal | NominatorResultsReveal,
  candidateCount: number,
  eligibleVoterCount: number,
): number {
  if (isInstantResultsReveal(mode)) return 0;
  if (isSteppedPlaceReveal(mode)) return Math.max(0, candidateCount);
  return Math.max(0, eligibleVoterCount);
}

export function isResultsRevealComplete(
  mode: ResultsReveal | NominatorResultsReveal,
  step: number,
  maxStep: number,
): boolean {
  if (isInstantResultsReveal(mode)) return true;
  if (maxStep < 1) return true;
  return step >= maxStep;
}

/**
 * Birthday Song Contest: hide who-owns-which-song (and birthdays) until the
 * final results step is fully presented — just before the host finishes.
 */
export function birthdayIdentitiesRevealed(input: {
  nominationKind: NominationKind;
  status: string;
  resultsPhase: ResultsPhase;
  nominatorRanking: boolean;
  nominatorRankingWhen: NominatorRankingWhen;
  nominatorResultsReveal: NominatorResultsReveal;
  resultsReveal: ResultsReveal;
  resultsRevealStep: number;
  resultsMaxStep: number;
  nominatorRevealStep: number;
  nominatorMaxStep: number;
}): boolean {
  if (input.nominationKind !== "birthday") return true;
  if (input.status !== "finished") return false;
  if (input.resultsPhase === "done") return true;

  const nomMode = nominatorRevealMode(
    input.nominatorResultsReveal,
    input.nominatorRankingWhen,
  );
  const candidateComplete = isResultsRevealComplete(
    input.resultsReveal,
    input.resultsRevealStep,
    input.resultsMaxStep,
  );
  const nominatorComplete = isResultsRevealComplete(
    nomMode,
    input.nominatorRevealStep,
    input.nominatorMaxStep,
  );

  if (!input.nominatorRanking || input.nominatorRankingWhen === "parallel") {
    return candidateComplete;
  }
  if (input.nominatorRankingWhen === "after") {
    return input.resultsPhase === "nominators" && nominatorComplete;
  }
  // nominator ranking before candidates → identities after candidates finish
  return input.resultsPhase === "candidates" && candidateComplete;
}
