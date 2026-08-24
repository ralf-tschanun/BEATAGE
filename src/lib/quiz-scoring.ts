import {
  DEFAULT_QUIZ_SETTINGS,
  type BeatageQuizSettings,
  type ScoringModeId,
} from "@/lib/quiz-settings";

export type YearScoreResult = {
  points: number;
  breakdown: Record<string, number>;
};

function scoreExact(guessed: number, correct: number): number {
  return guessed === correct ? 10 : 0;
}

/** Closer is better — 10 at exact, −1 per year off, floor 0. */
function scoreDistance(guessed: number, correct: number): number {
  return Math.max(0, 10 - Math.abs(guessed - correct));
}

function scoreRange(
  guessed: number,
  correct: number,
  tolerance: number,
): number {
  return Math.abs(guessed - correct) <= tolerance ? 5 : 0;
}

/** Hitster-style proximity buckets. */
function scoreHitster(guessed: number, correct: number): number {
  const diff = Math.abs(guessed - correct);
  if (diff === 0) return 10;
  if (diff <= 2) return 5;
  if (diff <= 5) return 3;
  if (diff <= 10) return 1;
  return 0;
}

function scoreOneMode(
  mode: ScoringModeId,
  guessed: number,
  correct: number,
  tolerance: number,
): number {
  switch (mode) {
    case "year_exact":
      return scoreExact(guessed, correct);
    case "year_distance":
      return scoreDistance(guessed, correct);
    case "year_range":
      return scoreRange(guessed, correct, tolerance);
    case "year_hitster":
      return scoreHitster(guessed, correct);
    case "chart_was_one":
    case "chart_weeks":
      // Chart modes need chart metadata — not scored on year alone yet.
      return 0;
    default:
      return 0;
  }
}

/** Normalize partial/legacy settings JSON from the quiz row. */
export function resolveQuizSettings(
  raw: unknown,
): BeatageQuizSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_QUIZ_SETTINGS };
  }
  const partial = raw as Partial<BeatageQuizSettings>;
  const modes = Array.isArray(partial.scoringModes)
    ? (partial.scoringModes.filter(Boolean) as ScoringModeId[])
    : DEFAULT_QUIZ_SETTINGS.scoringModes;
  return {
    ...DEFAULT_QUIZ_SETTINGS,
    ...partial,
    scoringModes: modes.length > 0 ? modes : DEFAULT_QUIZ_SETTINGS.scoringModes,
    yearRangeTolerance:
      partial.yearRangeTolerance === 5 ||
      partial.yearRangeTolerance === 10 ||
      partial.yearRangeTolerance === 15
        ? partial.yearRangeTolerance
        : DEFAULT_QUIZ_SETTINGS.yearRangeTolerance,
  };
}

/**
 * Score a year guess using the quiz scoring model(s).
 * Combined mode sums selected year modes; otherwise only the first mode applies.
 */
export function scoreYearGuess(opts: {
  guessedYear: number | null;
  correctYear: number | null;
  settings: BeatageQuizSettings;
}): YearScoreResult {
  const { guessedYear, correctYear, settings } = opts;
  const breakdown: Record<string, number> = {};

  if (guessedYear == null || correctYear == null) {
    return { points: 0, breakdown };
  }

  const yearModes = settings.scoringModes.filter(
    (mode) =>
      mode === "year_exact" ||
      mode === "year_distance" ||
      mode === "year_range" ||
      mode === "year_hitster",
  );
  const modes =
    yearModes.length > 0 ? yearModes : (["year_exact"] as ScoringModeId[]);

  const activeModes = settings.combinedScoring ? modes : [modes[0]];
  let points = 0;
  for (const mode of activeModes) {
    const pts = scoreOneMode(
      mode,
      guessedYear,
      correctYear,
      settings.yearRangeTolerance,
    );
    breakdown[mode] = pts;
    points += pts;
  }

  return { points, breakdown };
}
