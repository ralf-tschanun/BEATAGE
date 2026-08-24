import type {
  AnswerYearMode,
  ChartCountryCode,
  ScoringModeId,
} from "@/lib/quiz-settings";
import {
  clampAutoInterruptAfterEmptyRounds,
  clampYearRangeTolerance,
  DEFAULT_QUIZ_SETTINGS,
  normalizeScoringModes,
  scoringModeLabel,
  YEAR_RANGE_TOLERANCE_MAX,
  YEAR_RANGE_TOLERANCE_MIN,
} from "@/lib/quiz-settings";

export const CREATE_QUIZ_WIZARD_STORAGE_KEY = "beatage.create-quiz-wizard.v1";

export type DraftQuizSong = {
  title: string;
  artist: string;
  previewUrl: string;
  releaseYear?: number | null;
};

export type QuizPlayMode = "curate" | "auto_spotify";

export type CreateQuizWizardState = {
  step: number;
  hostName: string;
  title: string;
  description: string;
  /** Step 2: curated playlist vs Auto Spotify live rounds. */
  playMode: QuizPlayMode;
  draftSongs: DraftQuizSong[];
  chartCountries: ChartCountryCode[];
  scoringModes: ScoringModeId[];
  /** Range mode only (±0–20 years). */
  yearRangeTolerance: number;
  hostParticipates: boolean;
  /** Which release year counts as the answer. */
  answerYearMode: AnswerYearMode;
  showTitleArtist: boolean;
  showCorrectAnswer: boolean;
  showOverallResults: boolean;
  showResultDetails: boolean;
  /** Participants see other players in expanded previous-round results. */
  showOthersInPastResults: boolean;
  /** Auto Spotify: pause after this many consecutive empty rounds (1–10). */
  autoInterruptAfterEmptyRounds: number;
};

export const QUIZ_WIZARD_STEP_TITLES = [
  "Setup",
  "Playlist mode",
  "Quiz options",
  "Review",
] as const;

export function defaultQuizWizardState(hostName = ""): CreateQuizWizardState {
  return {
    step: 0,
    hostName: hostName.trim(),
    title: "",
    description: "",
    playMode: "curate",
    draftSongs: [{ title: "", artist: "", previewUrl: "", releaseYear: null }],
    chartCountries: [...DEFAULT_QUIZ_SETTINGS.chartCountries],
    scoringModes: [...DEFAULT_QUIZ_SETTINGS.scoringModes],
    yearRangeTolerance: DEFAULT_QUIZ_SETTINGS.yearRangeTolerance,
    hostParticipates: DEFAULT_QUIZ_SETTINGS.hostParticipates,
    answerYearMode: DEFAULT_QUIZ_SETTINGS.answerYearMode,
    showTitleArtist: DEFAULT_QUIZ_SETTINGS.showTitleArtist,
    showCorrectAnswer: DEFAULT_QUIZ_SETTINGS.showCorrectAnswer,
    showOverallResults: DEFAULT_QUIZ_SETTINGS.showOverallResults,
    showResultDetails: DEFAULT_QUIZ_SETTINGS.showResultDetails,
    showOthersInPastResults: DEFAULT_QUIZ_SETTINGS.showOthersInPastResults,
    autoInterruptAfterEmptyRounds:
      DEFAULT_QUIZ_SETTINGS.autoInterruptAfterEmptyRounds,
  };
}

export function quizWizardStepTitle(step: number): string {
  return QUIZ_WIZARD_STEP_TITLES[step] ?? "Review";
}

export function filledQuizSongs(state: CreateQuizWizardState): DraftQuizSong[] {
  return state.draftSongs.filter((song) => song.title.trim() && song.artist.trim());
}

export function validateQuizWizardStep(state: CreateQuizWizardState, step: number): string | null {
  if (step === 0) {
    if (!state.title.trim()) return "Please enter a quiz title.";
    if (!state.hostName.trim()) return "Please enter your name.";
    return null;
  }

  if (step === 1) {
    if (state.playMode === "auto_spotify") {
      return null;
    }
    const filled = filledQuizSongs(state);
    if (filled.length < 1) return "Please add at least one song.";
    if (
      state.draftSongs.some(
        (song) =>
          (song.title.trim() || song.artist.trim() || song.previewUrl.trim()) &&
          (!song.title.trim() || !song.artist.trim()),
      )
    ) {
      return "Please complete every song (or remove empty rows).";
    }
    return null;
  }

  if (step === 2) {
    if (state.chartCountries.length < 1) return "Select at least one chart country.";
    const modes = normalizeScoringModes(state.scoringModes);
    if (modes.length < 1) return "Select at least one scoring mode.";
    if (modes.includes("year_distance") && modes.includes("year_range")) {
      return "Closer wins and Range cannot be combined.";
    }
    if (modes.includes("year_range")) {
      const t = state.yearRangeTolerance;
      if (
        !Number.isFinite(t) ||
        t < YEAR_RANGE_TOLERANCE_MIN ||
        t > YEAR_RANGE_TOLERANCE_MAX
      ) {
        return `Range must be between ±${YEAR_RANGE_TOLERANCE_MIN} and ±${YEAR_RANGE_TOLERANCE_MAX} years.`;
      }
    }
    if (state.playMode === "auto_spotify") {
      const n = state.autoInterruptAfterEmptyRounds;
      if (!Number.isFinite(n) || n < 1 || n > 10) {
        return "Interrupt after empty songs must be between 1 and 10.";
      }
    }
    return null;
  }

  return null;
}

export function quizWizardSettingsSummary(state: CreateQuizWizardState): string {
  const mode =
    state.playMode === "auto_spotify" ? "Auto Spotify" : "Curated playlist";
  const songs = filledQuizSongs(state).length;
  const countries = state.chartCountries.join(", ");
  const modes = normalizeScoringModes(state.scoringModes);
  const scoring = modes.map(scoringModeLabel).join(" + ");
  const rangeBit = modes.includes("year_range")
    ? state.yearRangeTolerance === 0
      ? " · exact year = 1 pt"
      : ` · ±${state.yearRangeTolerance} years`
    : "";
  const yearBasis =
    state.answerYearMode === "original_recording"
      ? "Original recording"
      : "This release / cover";
  const visibility = [
    state.showTitleArtist ? "title shown" : "title hidden",
    state.showCorrectAnswer ? "answer shown" : "answer hidden",
    state.showOverallResults ? "leaderboard on" : "leaderboard off",
    state.showResultDetails ? "result details on" : "result details off",
    state.showResultDetails
      ? state.showOthersInPastResults
        ? "others in past results on"
        : "others in past results off"
      : null,
  ]
    .filter(Boolean)
    .join(", ");
  const autoBit =
    state.playMode === "auto_spotify"
      ? ` · Auto-interrupt after ${state.autoInterruptAfterEmptyRounds} empty`
      : "";
  if (state.playMode === "auto_spotify") {
    return `${mode} · ${yearBasis} · Charts: ${countries} · Scoring: ${scoring}${rangeBit} · ${visibility}${autoBit}`;
  }
  return `${mode} · ${songs} song${songs === 1 ? "" : "s"} · ${yearBasis} · Charts: ${countries} · Scoring: ${scoring}${rangeBit} · ${visibility}`;
}

type PersistedQuizWizardState = CreateQuizWizardState;

export function saveQuizWizardState(state: CreateQuizWizardState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CREATE_QUIZ_WIZARD_STORAGE_KEY,
      JSON.stringify(state satisfies PersistedQuizWizardState),
    );
  } catch {
    // ignore quota errors
  }
}

export function loadQuizWizardState(hostName: string): CreateQuizWizardState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CREATE_QUIZ_WIZARD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CreateQuizWizardState>;
    if (typeof parsed !== "object" || parsed === null) return null;
    const base = defaultQuizWizardState(hostName);
    return {
      ...base,
      ...parsed,
      playMode:
        parsed.playMode === "auto_spotify" || parsed.playMode === "curate"
          ? parsed.playMode
          : base.playMode,
      draftSongs:
        Array.isArray(parsed.draftSongs) && parsed.draftSongs.length > 0
          ? parsed.draftSongs.map((song) => ({
              title: String(song?.title ?? ""),
              artist: String(song?.artist ?? ""),
              previewUrl: String(song?.previewUrl ?? ""),
              releaseYear:
                typeof song?.releaseYear === "number" && Number.isFinite(song.releaseYear)
                  ? song.releaseYear
                  : null,
            }))
          : base.draftSongs,
      chartCountries:
        Array.isArray(parsed.chartCountries) && parsed.chartCountries.length > 0
          ? (parsed.chartCountries as ChartCountryCode[])
          : base.chartCountries,
      scoringModes: normalizeScoringModes(
        Array.isArray(parsed.scoringModes) && parsed.scoringModes.length > 0
          ? (parsed.scoringModes as ScoringModeId[])
          : base.scoringModes,
      ),
      yearRangeTolerance: clampYearRangeTolerance(
        parsed.yearRangeTolerance ?? base.yearRangeTolerance,
      ),
      answerYearMode:
        parsed.answerYearMode === "original_recording" ||
        parsed.answerYearMode === "this_release"
          ? parsed.answerYearMode
          : base.answerYearMode,
      showTitleArtist: Boolean(
        parsed.showTitleArtist ?? base.showTitleArtist,
      ),
      showCorrectAnswer: Boolean(
        parsed.showCorrectAnswer ?? base.showCorrectAnswer,
      ),
      showOverallResults: Boolean(
        parsed.showOverallResults ?? base.showOverallResults,
      ),
      showResultDetails: Boolean(
        parsed.showResultDetails ?? base.showResultDetails,
      ),
      showOthersInPastResults: Boolean(
        parsed.showOthersInPastResults ?? base.showOthersInPastResults,
      ),
      autoInterruptAfterEmptyRounds: clampAutoInterruptAfterEmptyRounds(
        parsed.autoInterruptAfterEmptyRounds ??
          base.autoInterruptAfterEmptyRounds,
      ),
    };
  } catch {
    return null;
  }
}

export function clearQuizWizardState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CREATE_QUIZ_WIZARD_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function hasMeaningfulQuizWizardDraft(state: CreateQuizWizardState): boolean {
  if (state.title.trim() || state.description.trim()) return true;
  if (state.draftSongs.some((song) => song.title.trim() || song.artist.trim())) return true;
  if (state.step > 0) return true;
  return false;
}
