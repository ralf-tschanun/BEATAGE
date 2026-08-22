export type QuizSource = "curated" | "spotify_live" | "shazam";

export type ChartCountryCode = "DE" | "AT" | "GB";

export type ScoringModeId =
  | "year_exact"
  | "year_distance"
  | "year_range"
  | "year_hitster"
  | "chart_was_one"
  | "chart_weeks";

export type BeatageQuizSettings = {
  source: QuizSource;
  chartCountries: ChartCountryCode[];
  guessPeriod: "until_next_track" | "host_manual" | "fixed_seconds";
  guessPeriodSeconds?: number;
  showTitleArtist: boolean;
  showCorrectAnswer: boolean;
  guessMutability: "editable_until_close" | "locked_on_submit";
  speedBonus: boolean;
  releaseMode: "automatic" | "host_manual";
  roundReveal: "live" | "after_round";
  overallReveal: "immediate" | "last_to_first" | "after_quiz";
  hostParticipates: boolean;
  scoringModes: ScoringModeId[];
  combinedScoring: boolean;
  secondaryScoringMode: ScoringModeId | null;
  yearRangeTolerance: 5 | 10 | 15;
  hitsterCrowdScaling: boolean;
};

export const DEFAULT_QUIZ_SETTINGS: BeatageQuizSettings = {
  source: "curated",
  chartCountries: ["DE"],
  guessPeriod: "host_manual",
  guessPeriodSeconds: 15,
  showTitleArtist: false,
  showCorrectAnswer: true,
  guessMutability: "editable_until_close",
  speedBonus: false,
  releaseMode: "host_manual",
  roundReveal: "after_round",
  overallReveal: "after_quiz",
  hostParticipates: true,
  scoringModes: ["year_exact"],
  combinedScoring: false,
  secondaryScoringMode: null,
  yearRangeTolerance: 5,
  hitsterCrowdScaling: false,
};

export function quizSourceLabel(source: QuizSource | string): string {
  if (source === "spotify_live") return "Spotify live";
  if (source === "shazam") return "Shazam";
  return "Curated list";
}
