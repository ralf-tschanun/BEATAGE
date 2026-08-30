import {
  clampAutoInterruptAfterEmptyRounds,
  clampYearRangeTolerance,
  DEFAULT_QUIZ_SETTINGS,
  isYearScoringMode,
  normalizeScoringModes,
  parseOverallReveal,
  primaryYearScoringMode,
  presentsLeaderboardAtEnd,
  type BeatageQuizSettings,
  type QuizSettingsRuntime,
  type YearScoringModeId,
} from "@/lib/quiz-settings";

export type YearScoreResult = {
  points: number;
  breakdown: Record<string, number>;
};

export type ChartGuessOutcome = "correct" | "none" | "wrong";

/** Extra years added on top of the worst submitted miss. */
export const CLOSER_WINS_NO_GUESS_EXTRA = 2;
/** Hard cap so a skip cannot explode when someone guesses 1900. */
export const CLOSER_WINS_NO_GUESS_YEAR_MAX = 20;

/** Closer wins: penalty = years off (lowest total wins). */
function scoreDistance(guessed: number, correct: number): number {
  return Math.abs(guessed - correct);
}

/** Pro Dynamic: same as Closer wins, but each year off costs 2 points. */
function scoreDistanceDynamic(guessed: number, correct: number): number {
  return scoreDistance(guessed, correct) * 2;
}

/**
 * Year-off distances from submitted guesses only.
 * Null / missing years (skippers) must not be included — skip penalties
 * are derived once from this list, then shared by every skipper.
 */
export function submittedCloserWinsDistances(
  guessedYears: Array<number | null | undefined>,
  correctYear: number,
): number[] {
  const distances: number[] = [];
  for (const year of guessedYears) {
    if (typeof year !== "number" || !Number.isFinite(year)) continue;
    distances.push(Math.abs(year - correctYear));
  }
  return distances;
}

/**
 * Closer wins skip: one shared penalty for every skipper.
 * Input must be distances from submitted years only — never skip scores,
 * or skippers would inflate each other (worst+2, then that+2, …).
 * If nobody submitted a year, use the cap (20).
 */
export function closerWinsNoGuessYearPenalty(
  submittedDistances: number[],
): number {
  const distances = submittedDistances.filter(
    (d) => typeof d === "number" && Number.isFinite(d) && d >= 0,
  );
  if (distances.length === 0) {
    return CLOSER_WINS_NO_GUESS_YEAR_MAX;
  }
  const worst = Math.max(...distances);
  return Math.min(
    CLOSER_WINS_NO_GUESS_YEAR_MAX,
    worst + CLOSER_WINS_NO_GUESS_EXTRA,
  );
}

/**
 * Pro Dynamic skip: same shared Closest-wins skip, then ×2 (points).
 */
export function closerWinsDynamicNoGuessPenalty(
  submittedDistances: number[],
): number {
  return closerWinsNoGuessYearPenalty(submittedDistances) * 2;
}

/**
 * Range: at tolerance T>0, exact = T, each year off loses 1, floor 0.
 * At T=0, only an exact year scores 1.
 */
function scoreRange(
  guessed: number,
  correct: number,
  tolerance: number,
): number {
  const diff = Math.abs(guessed - correct);
  if (tolerance === 0) return diff === 0 ? 1 : 0;
  return Math.max(0, tolerance - diff);
}

/** Correct answer year for the quiz’s answerYearMode. */
export function correctYearForScoring(opts: {
  releaseYear: number | null;
  originalReleaseYear: number | null;
  answerYearMode: BeatageQuizSettings["answerYearMode"];
}): number | null {
  if (opts.answerYearMode === "original_recording") {
    return opts.originalReleaseYear ?? opts.releaseYear;
  }
  return opts.releaseYear;
}

export function chartGuessOutcome(
  guessedWasNumberOne: boolean | null | undefined,
  wasNumberOne: boolean,
): ChartGuessOutcome {
  if (guessedWasNumberOne == null) return "none";
  return guessedWasNumberOne === wasNumberOne ? "correct" : "wrong";
}

/**
 * Extra Chart #1 points when combined with a year mode.
 * Closer wins / Pro (low wins): correct 0, no answer 1, wrong 2 (penalty).
 * Range (high wins): correct 2, no answer 1, wrong 0 (mirror of closer).
 */
export function chartComboExtraPoints(
  outcome: ChartGuessOutcome,
  yearMode: YearScoringModeId,
): number {
  if (yearMode === "year_distance" || yearMode === "year_distance_dynamic") {
    if (outcome === "correct") return 0;
    if (outcome === "none") return 1;
    return 2;
  }
  if (outcome === "correct") return 2;
  if (outcome === "none") return 1;
  return 0;
}

/** Normalize partial/legacy settings JSON from the quiz row. */
export function resolveQuizSettings(raw: unknown): BeatageQuizSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_QUIZ_SETTINGS };
  }
  const partial = raw as Partial<BeatageQuizSettings>;
  const scoringModes = normalizeScoringModes(partial.scoringModes);
  const resolved: BeatageQuizSettings = {
    ...DEFAULT_QUIZ_SETTINGS,
    ...partial,
    scoringModes,
    combinedScoring: scoringModes.length > 1,
    secondaryScoringMode:
      scoringModes.length > 1
        ? (scoringModes.find((mode) => mode === "chart_was_one") ??
          scoringModes[1] ??
          null)
        : null,
    yearRangeTolerance: clampYearRangeTolerance(partial.yearRangeTolerance),
    answerYearMode:
      partial.answerYearMode === "original_recording" ||
      partial.answerYearMode === "this_release"
        ? partial.answerYearMode
        : DEFAULT_QUIZ_SETTINGS.answerYearMode,
    showTitleArtist: Boolean(
      partial.showTitleArtist ?? DEFAULT_QUIZ_SETTINGS.showTitleArtist,
    ),
    showCorrectAnswer: Boolean(
      partial.showCorrectAnswer ?? DEFAULT_QUIZ_SETTINGS.showCorrectAnswer,
    ),
    showOverallResults: Boolean(
      partial.showOverallResults ?? DEFAULT_QUIZ_SETTINGS.showOverallResults,
    ),
    showResultDetails: Boolean(
      partial.showResultDetails ?? DEFAULT_QUIZ_SETTINGS.showResultDetails,
    ),
    showOthersInPastResults: Boolean(
      partial.showOthersInPastResults ??
        DEFAULT_QUIZ_SETTINGS.showOthersInPastResults,
    ),
    overallReveal: parseOverallReveal(partial.overallReveal),
    autoInterruptAfterEmptyRounds: clampAutoInterruptAfterEmptyRounds(
      partial.autoInterruptAfterEmptyRounds ??
        DEFAULT_QUIZ_SETTINGS.autoInterruptAfterEmptyRounds,
    ),
    lastfmUsername:
      typeof partial.lastfmUsername === "string"
        ? partial.lastfmUsername.trim().replace(/^@/, "")
        : DEFAULT_QUIZ_SETTINGS.lastfmUsername,
  };

  // Presentation mode keeps the running board hidden until the host presents.
  if (presentsLeaderboardAtEnd(resolved)) {
    resolved.showOverallResults = false;
  }

  return resolved;
}

/** Read Auto Spotify / presentation runtime flags from the raw settings JSON. */
export function readQuizSettingsRuntime(raw: unknown): QuizSettingsRuntime {
  if (!raw || typeof raw !== "object") return {};
  const row = raw as QuizSettingsRuntime;
  return {
    autoEmptyStreak:
      typeof row.autoEmptyStreak === "number" && Number.isFinite(row.autoEmptyStreak)
        ? Math.max(0, Math.round(row.autoEmptyStreak))
        : 0,
    autoInterrupted: Boolean(row.autoInterrupted),
    leaderboardRevealStep:
      typeof row.leaderboardRevealStep === "number" &&
      Number.isFinite(row.leaderboardRevealStep)
        ? Math.max(0, Math.round(row.leaderboardRevealStep))
        : 0,
    // Missing flag = already started (legacy quizzes). New live quizzes set false on create.
    quizStarted:
      typeof row.quizStarted === "boolean"
        ? row.quizStarted
        : row.quizStarted === "false"
          ? false
          : row.quizStarted === "true"
            ? true
            : true,
    preRoundCutoff:
      typeof row.preRoundCutoff === "number" && Number.isFinite(row.preRoundCutoff)
        ? Math.max(0, Math.round(row.preRoundCutoff))
        : 0,
    liveSyncEnabled: Boolean(row.liveSyncEnabled),
    liveSyncArmedAt: parseRuntimeIso(row.liveSyncArmedAt),
    liveSyncNotPlayingSince: parseRuntimeIso(row.liveSyncNotPlayingSince),
    liveSyncHadPlayback: Boolean(row.liveSyncHadPlayback),
    liveDeferredTrackKey:
      typeof row.liveDeferredTrackKey === "string" &&
      row.liveDeferredTrackKey.trim()
        ? row.liveDeferredTrackKey.trim()
        : null,
    liveOpenMode: row.liveOpenMode === "manual" ? "manual" : "automatic",
  };
}

function parseRuntimeIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? trimmed : null;
}

/** Merge play settings + runtime flags for persistence on beatage_quizzes.settings. */
export function mergeQuizSettingsForStorage(
  settings: BeatageQuizSettings,
  runtime: QuizSettingsRuntime = {},
): BeatageQuizSettings & QuizSettingsRuntime {
  return {
    ...settings,
    autoEmptyStreak: runtime.autoEmptyStreak ?? 0,
    autoInterrupted: Boolean(runtime.autoInterrupted),
    leaderboardRevealStep: runtime.leaderboardRevealStep ?? 0,
    quizStarted:
      typeof runtime.quizStarted === "boolean" ? runtime.quizStarted : true,
    preRoundCutoff:
      typeof runtime.preRoundCutoff === "number" &&
      Number.isFinite(runtime.preRoundCutoff)
        ? Math.max(0, Math.round(runtime.preRoundCutoff))
        : 0,
    liveSyncEnabled: Boolean(runtime.liveSyncEnabled),
    liveSyncArmedAt: runtime.liveSyncArmedAt ?? null,
    liveSyncNotPlayingSince: runtime.liveSyncNotPlayingSince ?? null,
    liveSyncHadPlayback: Boolean(runtime.liveSyncHadPlayback),
    liveDeferredTrackKey: runtime.liveDeferredTrackKey ?? null,
    liveOpenMode: runtime.liveOpenMode === "manual" ? "manual" : "automatic",
  };
}

/**
 * Score a guess with the active models.
 * Combined Chart #1 uses the player’s yes/no guess (correct / none / wrong).
 * Standalone Chart #1 still awards 1 if the song was a #1, else 0.
 */
export function scoreYearGuess(opts: {
  guessedYear: number | null;
  correctYear: number | null;
  settings: BeatageQuizSettings;
  wasNumberOne?: boolean;
  guessedWasNumberOne?: boolean | null;
  /** Closer wins / Pro only: penalty when guessedYear is null. */
  noGuessYearPenalty?: number;
}): YearScoreResult {
  const modes = normalizeScoringModes(opts.settings.scoringModes);
  const yearMode = primaryYearScoringMode(modes);
  const hasYear = modes.some(isYearScoringMode);
  const hasChart = modes.includes("chart_was_one");
  const breakdown: Record<string, number> = {};
  const wasOne = Boolean(opts.wasNumberOne);

  let yearPts = 0;
  if (hasYear && opts.correctYear != null) {
    if (opts.guessedYear != null) {
      if (yearMode === "year_distance") {
        yearPts = scoreDistance(opts.guessedYear, opts.correctYear);
        breakdown.year_distance = yearPts;
      } else if (yearMode === "year_distance_dynamic") {
        yearPts = scoreDistanceDynamic(opts.guessedYear, opts.correctYear);
        breakdown.year_distance_dynamic = yearPts;
      } else {
        yearPts = scoreRange(
          opts.guessedYear,
          opts.correctYear,
          clampYearRangeTolerance(opts.settings.yearRangeTolerance),
        );
        breakdown.year_range = yearPts;
      }
    } else if (
      yearMode === "year_distance" ||
      yearMode === "year_distance_dynamic"
    ) {
      const fallbackMax =
        yearMode === "year_distance_dynamic"
          ? CLOSER_WINS_NO_GUESS_YEAR_MAX * 2
          : CLOSER_WINS_NO_GUESS_YEAR_MAX;
      yearPts = opts.noGuessYearPenalty ?? fallbackMax;
      breakdown[yearMode] = yearPts;
    }
  }

  let chartPts = 0;
  if (hasChart) {
    if (hasYear) {
      const outcome = chartGuessOutcome(opts.guessedWasNumberOne, wasOne);
      chartPts = chartComboExtraPoints(outcome, yearMode);
    } else {
      chartPts = wasOne ? 1 : 0;
    }
    breakdown.chart_was_one = chartPts;
  }

  return { points: yearPts + chartPts, breakdown };
}
