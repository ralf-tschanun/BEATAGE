export type QuizSource = "curated" | "spotify_live" | "shazam" | "lastfm_live";

export type ChartCountryCode = "DE" | "AT" | "GB";

export type ScoringModeId =
  | "year_distance"
  | "year_distance_dynamic"
  | "year_range"
  | "chart_was_one";

/** Mutually exclusive year-based scoring models (Chart #1 is optional on top). */
export type YearScoringModeId =
  | "year_distance"
  | "year_distance_dynamic"
  | "year_range";

/**
 * Which year counts as the quiz answer.
 * Remasters / sampler compilations are filtered in both modes.
 * - this_release: the played cover/variant (e.g. Fugees)
 * - original_recording: first recording of the song (e.g. Roberta Flack)
 */
export type AnswerYearMode = "this_release" | "original_recording";

/**
 * How the final leaderboard is shown after the quiz ends.
 * When immediate / last_to_first, showOverallResults is forced off so the
 * running board stays hidden until the host presents.
 */
export type OverallReveal = "immediate" | "last_to_first" | "after_quiz";

export type BeatageQuizSettings = {
  source: QuizSource;
  chartCountries: ChartCountryCode[];
  guessPeriod: "until_next_track" | "host_manual" | "fixed_seconds";
  guessPeriodSeconds?: number;
  /** Show song title & artist during the live round (host and participants). */
  showTitleArtist: boolean;
  /** Show the correct release year after a round closes. */
  showCorrectAnswer: boolean;
  /** Show the running overall leaderboard (with scores) during the quiz. */
  showOverallResults: boolean;
  /**
   * Previous-rounds list: show release years and expandable full round results.
   * When false, show the player's points for that round instead of the year.
   */
  showResultDetails: boolean;
  /**
   * When result details are on: participants see other players’ guesses in
   * expanded previous rounds. Host always sees the full list.
   */
  showOthersInPastResults: boolean;
  /**
   * Live auto modes only: pause auto ingest after this many consecutive rounds
   * with zero guesses (1–10). Host must continue to resume.
   */
  autoInterruptAfterEmptyRounds: number;
  /**
   * Last.fm username for lastfm_live quizzes (Spotify must scrobble to this account).
   */
  lastfmUsername: string;
  guessMutability: "editable_until_close" | "locked_on_submit";
  speedBonus: boolean;
  releaseMode: "automatic" | "host_manual";
  /** Year basis for scoring answers. */
  answerYearMode: AnswerYearMode;
  roundReveal: "live" | "after_round";
  /**
   * End-of-quiz leaderboard presentation (MyContest-style).
   * - after_quiz: no staged presentation; full board when finished
   * - immediate: host presents the full ranking at once
   * - last_to_first: host reveals one place at a time from last to first
   */
  overallReveal: OverallReveal;
  hostParticipates: boolean;
  scoringModes: ScoringModeId[];
  combinedScoring: boolean;
  secondaryScoringMode: ScoringModeId | null;
  /** Range mode only: 0 = exact match scores 1, else max(0, tolerance − |diff|). */
  yearRangeTolerance: number;
  hitsterCrowdScaling: boolean;
};

/** Runtime flags stored alongside settings JSON (not wizard create fields). */
export type QuizSettingsRuntime = {
  autoEmptyStreak?: number;
  autoInterrupted?: boolean;
  /** Host-controlled end presentation progress (0 = not started). */
  leaderboardRevealStep?: number;
  /**
   * Live quizzes only: false until the host clicks Start Quiz Now.
   * While false, new rounds are pre-rounds (practice). Undefined = already started
   * (backwards compatible with quizzes created before this flag existed).
   */
  quizStarted?: boolean;
  /**
   * After Start Quiz Now: highest round_number that stays a pre-round.
   * Rounds with round_number <= cutoff stay labeled as Pre Round and stay
   * out of the official leaderboard. 0 = no pre-rounds were played.
   * Starting with the current song sets this to the previous closed pre-round
   * so the open warm-up round becomes Round 1.
   */
  preRoundCutoff?: number;
  /**
   * Last.fm live: server cron may follow Now Playing while the host tab is hidden.
   * Host Pause / End / Finish, empty-streak interrupt, silence, and the 4h cap clear this.
   */
  liveSyncEnabled?: boolean;
  /** ISO time when live sync was last armed (4h server-sync cap). */
  liveSyncArmedAt?: string | null;
  /** ISO time since Last.fm reported nothing playing (after we have seen playback). */
  liveSyncNotPlayingSince?: string | null;
  /** True after Last.fm reported a now-playing track at least once this arm. */
  liveSyncHadPlayback?: boolean;
  /** Skip-lock so Pause / Close / Skip does not reopen the same Last.fm track. */
  liveDeferredTrackKey?: string | null;
  /** Host listen mode. Cron auto-opens rounds only in automatic. */
  liveOpenMode?: "automatic" | "manual";
};

/** Label for a round in host / participant UI. */
export function formatRoundLabel(opts: {
  isPreRound: boolean;
  displayRoundNumber: number;
}): string {
  const n = Math.max(1, Math.round(opts.displayRoundNumber));
  return opts.isPreRound ? `Pre Round ${n}` : `Round ${n}`;
}

/** Short badge for non-standard round outcomes in history lists. */
export function roundOutcomeLabel(status: string): string | null {
  if (status === "skipped") return "Skipped";
  if (status === "excluded") return "Excluded";
  return null;
}

/** True when the live quiz was auto-paused after consecutive empty rounds. */
export function isInactivityQuizInterrupt(
  autoInterrupted: boolean,
  autoEmptyStreak: number,
  emptyStreakThreshold: number,
): boolean {
  return (
    autoInterrupted &&
    autoEmptyStreak >= Math.max(1, Math.round(emptyStreakThreshold))
  );
}

/** Whether a round counts as warm-up (not official quiz scoring). */
export function isPreRoundNumber(
  roundNumber: number,
  runtime: Pick<QuizSettingsRuntime, "quizStarted" | "preRoundCutoff">,
): boolean {
  // Explicit false only — missing/undefined means legacy quiz (already started).
  if (runtime.quizStarted === false) return true;
  const cutoff =
    typeof runtime.preRoundCutoff === "number" &&
    Number.isFinite(runtime.preRoundCutoff)
      ? Math.max(0, Math.round(runtime.preRoundCutoff))
      : 0;
  return cutoff > 0 && roundNumber <= cutoff;
}

/** Official (non-pre, non-skipped) rounds consume the plan / unlock cap. */
export function roundConsumesPlanCap(
  round: { round_number: number; status: string },
  runtime: Pick<QuizSettingsRuntime, "quizStarted" | "preRoundCutoff">,
): boolean {
  if (round.status === "skipped") return false;
  return !isPreRoundNumber(round.round_number, runtime);
}

/** Wizard / rules labels for end-of-quiz leaderboard presentation modes. */
export const QUIZ_LEADERBOARD_REVEAL_OPTIONS: Record<
  Exclude<OverallReveal, "after_quiz">,
  { label: string; description: string }
> = {
  immediate: {
    label: "All at once (host)",
    description:
      "After the quiz ends, the host presents the full leaderboard with ranks and scores right away.",
  },
  last_to_first: {
    label: "Last to first (host)",
    description:
      "Host reveals one place at a time from last to first — the winner is presented last. EXCITING!",
  },
};

export function parseOverallReveal(raw: unknown): OverallReveal {
  if (raw === "immediate" || raw === "last_to_first" || raw === "after_quiz") {
    return raw;
  }
  return "after_quiz";
}

/** True when the host will stage a leaderboard presentation after finish. */
export function presentsLeaderboardAtEnd(
  settings: Pick<BeatageQuizSettings, "overallReveal">,
): boolean {
  return (
    settings.overallReveal === "immediate" ||
    settings.overallReveal === "last_to_first"
  );
}

/** Visible leaderboard rows for the current presentation step. */
export function applyQuizLeaderboardReveal<T>(
  mode: OverallReveal,
  step: number,
  fullResults: T[],
): T[] {
  if (mode === "after_quiz") return fullResults;
  if (mode === "immediate") return step > 0 ? fullResults : [];
  if (step <= 0) return [];
  return fullResults.slice(Math.max(0, fullResults.length - step));
}

export function isQuizLeaderboardRevealComplete(
  mode: OverallReveal,
  step: number,
  playerCount: number,
): boolean {
  if (mode === "after_quiz") return true;
  if (mode === "immediate") return step > 0;
  if (playerCount < 1) return true;
  return step >= playerCount;
}

/** Next step after a host reveal click, or null when already complete. */
export function nextQuizLeaderboardRevealStep(
  mode: OverallReveal,
  step: number,
  playerCount: number,
): number | null {
  if (mode === "after_quiz") return null;
  if (isQuizLeaderboardRevealComplete(mode, step, playerCount)) return null;
  if (mode === "immediate") return 1;
  return Math.min(step + 1, Math.max(1, playerCount));
}

export const DEFAULT_QUIZ_SETTINGS: BeatageQuizSettings = {
  source: "curated",
  chartCountries: ["DE"],
  guessPeriod: "host_manual",
  guessPeriodSeconds: 15,
  showTitleArtist: false,
  showCorrectAnswer: true,
  showOverallResults: true,
  showResultDetails: true,
  showOthersInPastResults: false,
  autoInterruptAfterEmptyRounds: 3,
  lastfmUsername: "",
  guessMutability: "editable_until_close",
  speedBonus: false,
  releaseMode: "host_manual",
  answerYearMode: "this_release",
  roundReveal: "after_round",
  overallReveal: "after_quiz",
  hostParticipates: true,
  scoringModes: ["year_distance"],
  combinedScoring: false,
  secondaryScoringMode: null,
  yearRangeTolerance: 10,
  hitsterCrowdScaling: false,
};

export const YEAR_RANGE_TOLERANCE_MIN = 0;
export const YEAR_RANGE_TOLERANCE_MAX = 20;

export function clampYearRangeTolerance(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_QUIZ_SETTINGS.yearRangeTolerance;
  return Math.min(
    YEAR_RANGE_TOLERANCE_MAX,
    Math.max(YEAR_RANGE_TOLERANCE_MIN, Math.round(n)),
  );
}

const ACTIVE_SCORING_MODES = new Set<ScoringModeId>([
  "year_distance",
  "year_distance_dynamic",
  "year_range",
  "chart_was_one",
]);

const YEAR_SCORING_MODES = new Set<YearScoringModeId>([
  "year_distance",
  "year_distance_dynamic",
  "year_range",
]);

export function isYearScoringMode(
  mode: string | null | undefined,
): mode is YearScoringModeId {
  return YEAR_SCORING_MODES.has(mode as YearScoringModeId);
}

/** Active year model from scoringModes (defaults to Basic). */
export function primaryYearScoringMode(
  modes: ScoringModeId[] | string[] | null | undefined,
): YearScoringModeId {
  const normalized = normalizeScoringModes(modes);
  const year = normalized.find(isYearScoringMode);
  return year ?? "year_distance";
}

/** Drop retired modes and keep year models mutually exclusive. */
export function normalizeScoringModes(
  modes: ScoringModeId[] | string[] | null | undefined,
): ScoringModeId[] {
  const mapped: ScoringModeId[] = [];
  for (const raw of modes ?? []) {
    const mode =
      raw === "year_exact" || raw === "year_hitster"
        ? "year_distance"
        : raw === "chart_weeks"
          ? "chart_was_one"
          : raw;
    if (!ACTIVE_SCORING_MODES.has(mode as ScoringModeId)) continue;
    if (!mapped.includes(mode as ScoringModeId)) mapped.push(mode as ScoringModeId);
  }
  const yearModes = mapped.filter(isYearScoringMode);
  const chart = mapped.includes("chart_was_one");
  const year = yearModes[0] ?? null;
  const next: ScoringModeId[] = [];
  if (year) next.push(year);
  if (chart) next.push("chart_was_one");
  return next.length > 0 ? next : [...DEFAULT_QUIZ_SETTINGS.scoringModes];
}

/** Basic / Pro closer-wins use penalty points — lowest total wins. */
export function scoringLowWins(settings: Pick<BeatageQuizSettings, "scoringModes">): boolean {
  const year = primaryYearScoringMode(settings.scoringModes);
  return year === "year_distance" || year === "year_distance_dynamic";
}

/** Score unit shown in play UI: years for Basic, points for Pro Dynamic / Range. */
export function scoringUnitLabel(
  settings: Pick<BeatageQuizSettings, "scoringModes">,
): "yr" | "pt" {
  return primaryYearScoringMode(settings.scoringModes) === "year_distance"
    ? "yr"
    : "pt";
}

/** Chart #1 combined with a year model (player yes/no guess). */
export function scoringCombinesChart(
  settings: Pick<BeatageQuizSettings, "scoringModes">,
): boolean {
  const modes = settings.scoringModes;
  return modes.includes("chart_was_one") && modes.some(isYearScoringMode);
}

/**
 * Set the exclusive year scoring model while keeping Chart #1 if selected.
 */
export function setYearScoringModeSelection(
  current: ScoringModeId[] | string[] | null | undefined,
  yearMode: YearScoringModeId,
): ScoringModeId[] {
  const chart = normalizeScoringModes(current).includes("chart_was_one");
  const next: ScoringModeId[] = [yearMode];
  if (chart) next.push("chart_was_one");
  return normalizeScoringModes(next);
}

/**
 * Toggle scoring modes with mutex among year models; Chart #1 optional.
 * Always keeps at least one mode selected.
 */
export function toggleScoringModeSelection(
  current: ScoringModeId[] | string[] | null | undefined,
  mode: ScoringModeId,
): ScoringModeId[] {
  const selected = new Set(normalizeScoringModes(current));
  if (isYearScoringMode(mode)) {
    return setYearScoringModeSelection(current, mode);
  }
  if (mode === "chart_was_one") {
    if (selected.has("chart_was_one")) selected.delete("chart_was_one");
    else selected.add("chart_was_one");
  }
  const next = [...selected] as ScoringModeId[];
  return next.length > 0 ? normalizeScoringModes(next) : [...DEFAULT_QUIZ_SETTINGS.scoringModes];
}

export const AUTO_INTERRUPT_EMPTY_ROUNDS_MIN = 1;
export const AUTO_INTERRUPT_EMPTY_ROUNDS_MAX = 10;

export function clampAutoInterruptAfterEmptyRounds(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_QUIZ_SETTINGS.autoInterruptAfterEmptyRounds;
  return Math.min(
    AUTO_INTERRUPT_EMPTY_ROUNDS_MAX,
    Math.max(AUTO_INTERRUPT_EMPTY_ROUNDS_MIN, Math.round(n)),
  );
}

export function answerYearModeLabel(mode: AnswerYearMode | string): string {
  if (mode === "original_recording") return "Original release year";
  return "Played Cover";
}

export function quizSourceLabel(source: QuizSource | string): string {
  if (source === "spotify_live") return "Spotify live";
  if (source === "lastfm_live") return "Live Spotify (Last.fm)";
  if (source === "shazam") return "Shazam";
  return "Curated list";
}

/** Auto ingest from an external player (no curated playlist required). */
export function isLiveQuizSource(source: QuizSource | string | null | undefined): boolean {
  return source === "spotify_live" || source === "lastfm_live";
}

export const SCORING_MODE_LABELS: Record<ScoringModeId, string> = {
  year_distance: "Basic - Closer wins",
  year_distance_dynamic: "Pro - Closer wins - Dynamic",
  year_range: "Range",
  chart_was_one: "Chart #1",
};

/** Wizard / rules copy for the year scoring select (like leaderboard present). */
export const QUIZ_YEAR_SCORING_OPTIONS: Record<
  YearScoringModeId,
  { label: string; description: string }
> = {
  year_distance: {
    label: SCORING_MODE_LABELS.year_distance,
    description:
      "Try to hit the release year. Any difference counts against you. Lowest score wins.",
  },
  year_distance_dynamic: {
    label: SCORING_MODE_LABELS.year_distance_dynamic,
    description:
      "Try to hit the release year. Stay close — high differences count against you twice. Lowest score wins.",
  },
  year_range: {
    label: SCORING_MODE_LABELS.year_range,
    description:
      "Score only within the selected range. Hit the exact release year for maximum points; out of range = no points. Highest points wins.",
  },
};

export function scoringModeLabel(mode: ScoringModeId | string): string {
  return SCORING_MODE_LABELS[mode as ScoringModeId] ?? mode;
}
