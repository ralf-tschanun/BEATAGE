export type QuizSource = "curated" | "spotify_live" | "shazam" | "lastfm_live";

export type ChartCountryCode = "DE" | "AT" | "GB";

export type ScoringModeId =
  | "year_distance"
  | "year_range"
  | "chart_was_one";

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
};

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
  "year_range",
  "chart_was_one",
]);

/** Drop retired modes and keep Closer wins / Range mutually exclusive. */
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
  const yearModes = mapped.filter(
    (mode) => mode === "year_distance" || mode === "year_range",
  );
  const chart = mapped.includes("chart_was_one");
  const year = yearModes[0] ?? null;
  const next: ScoringModeId[] = [];
  if (year) next.push(year);
  if (chart) next.push("chart_was_one");
  return next.length > 0 ? next : [...DEFAULT_QUIZ_SETTINGS.scoringModes];
}

/** Closer wins uses penalty points — lowest total wins. */
export function scoringLowWins(settings: Pick<BeatageQuizSettings, "scoringModes">): boolean {
  return settings.scoringModes.includes("year_distance");
}

/** Chart #1 combined with Closer wins or Range (player yes/no guess). */
export function scoringCombinesChart(
  settings: Pick<BeatageQuizSettings, "scoringModes">,
): boolean {
  const modes = settings.scoringModes;
  return (
    modes.includes("chart_was_one") &&
    (modes.includes("year_distance") || modes.includes("year_range"))
  );
}

/**
 * Toggle scoring modes with mutex: Closer wins XOR Range; Chart #1 optional.
 * Always keeps at least one mode selected.
 */
export function toggleScoringModeSelection(
  current: ScoringModeId[] | string[] | null | undefined,
  mode: ScoringModeId,
): ScoringModeId[] {
  const selected = new Set(normalizeScoringModes(current));
  if (mode === "year_distance" || mode === "year_range") {
    const other = mode === "year_distance" ? "year_range" : "year_distance";
    if (selected.has(mode)) {
      selected.delete(mode);
    } else {
      selected.delete(other);
      selected.add(mode);
    }
  } else if (mode === "chart_was_one") {
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
  year_distance: "Closer wins",
  year_range: "Range",
  chart_was_one: "Chart #1",
};

export function scoringModeLabel(mode: ScoringModeId | string): string {
  return SCORING_MODE_LABELS[mode as ScoringModeId] ?? mode;
}
