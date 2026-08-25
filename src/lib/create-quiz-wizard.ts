import { BRAND_NAME } from "@/lib/brand";
import type {
  AnswerYearMode,
  ChartCountryCode,
  OverallReveal,
  ScoringModeId,
} from "@/lib/quiz-settings";
import {
  clampAutoInterruptAfterEmptyRounds,
  clampYearRangeTolerance,
  DEFAULT_QUIZ_SETTINGS,
  normalizeScoringModes,
  parseOverallReveal,
  presentsLeaderboardAtEnd,
  scoringModeLabel,
  YEAR_RANGE_TOLERANCE_MAX,
  YEAR_RANGE_TOLERANCE_MIN,
} from "@/lib/quiz-settings";

export const CREATE_QUIZ_WIZARD_STORAGE_KEY = "beatage.create-quiz-wizard.v1";

/** Survives draft clear — Last.fm username is reused across quizzes. */
export const LASTFM_USERNAME_STORAGE_KEY = "beatage.lastfm-username.v1";

/** Empty title → brand default so hosts can leave the field blank. */
export const DEFAULT_QUIZ_TITLE = `${BRAND_NAME} Quiz`;

export function effectiveQuizTitle(title: string): string {
  return title.trim() || DEFAULT_QUIZ_TITLE;
}

export type DraftQuizSong = {
  title: string;
  artist: string;
  previewUrl: string;
  releaseYear?: number | null;
};

export type QuizPlayMode = "curate" | "auto_lastfm" | "auto_spotify";

export type CreateQuizWizardState = {
  step: number;
  hostName: string;
  title: string;
  description: string;
  /** Step 2: curated playlist vs live auto rounds. */
  playMode: QuizPlayMode;
  /** Last.fm username when playMode is auto_lastfm. */
  lastfmUsername: string;
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
  /**
   * When true, host presents the final leaderboard after the quiz
   * (forces overall results / others in past results off).
   */
  presentLeaderboardAtEnd: boolean;
  /** Used when presentLeaderboardAtEnd is on (immediate | last_to_first). */
  overallReveal: Exclude<OverallReveal, "after_quiz">;
  /** Live auto: pause after this many consecutive empty rounds (1–10). */
  autoInterruptAfterEmptyRounds: number;
};

export const QUIZ_WIZARD_STEP_TITLES = [
  "Setup",
  "Playlist mode",
  "Quiz options",
] as const;

export function defaultQuizWizardState(hostName = ""): CreateQuizWizardState {
  return {
    step: 0,
    hostName: hostName.trim(),
    title: "",
    description: "",
    playMode: "auto_lastfm",
    lastfmUsername: "",
    draftSongs: [{ title: "", artist: "", previewUrl: "", releaseYear: null }],
    chartCountries: [...DEFAULT_QUIZ_SETTINGS.chartCountries],
    scoringModes: [...DEFAULT_QUIZ_SETTINGS.scoringModes],
    yearRangeTolerance: DEFAULT_QUIZ_SETTINGS.yearRangeTolerance,
    hostParticipates: DEFAULT_QUIZ_SETTINGS.hostParticipates,
    answerYearMode: DEFAULT_QUIZ_SETTINGS.answerYearMode,
    showTitleArtist: DEFAULT_QUIZ_SETTINGS.showTitleArtist,
    showCorrectAnswer: DEFAULT_QUIZ_SETTINGS.showCorrectAnswer,
    showOverallResults: false,
    showResultDetails: true,
    showOthersInPastResults: false,
    presentLeaderboardAtEnd: true,
    overallReveal: "last_to_first",
    autoInterruptAfterEmptyRounds:
      DEFAULT_QUIZ_SETTINGS.autoInterruptAfterEmptyRounds,
  };
}

/**
 * Quick Live Quiz always starts from wizard defaults — never from a draft’s
 * tweaked options. Only title / host / description / Last.fm are carried over.
 */
export function quickLiveQuizWizardState(opts: {
  hostName: string;
  title?: string;
  description?: string;
  lastfmUsername: string;
}): CreateQuizWizardState {
  const host = opts.hostName.trim();
  return {
    ...defaultQuizWizardState(host),
    title: opts.title?.trim() ?? "",
    description: opts.description?.trim() ?? "",
    hostName: host,
    playMode: "auto_lastfm",
    lastfmUsername: opts.lastfmUsername.trim().replace(/^@/, ""),
    step: 0,
  };
}

export function quizWizardStepTitle(step: number): string {
  return QUIZ_WIZARD_STEP_TITLES[step] ?? "Quiz options";
}

export function filledQuizSongs(state: CreateQuizWizardState): DraftQuizSong[] {
  return state.draftSongs.filter((song) => song.title.trim() && song.artist.trim());
}

export function validateQuizWizardStep(state: CreateQuizWizardState, step: number): string | null {
  if (step === 0) {
    if (!state.hostName.trim()) return "Please enter your name.";
    return null;
  }

  if (step === 1) {
    if (state.playMode === "auto_lastfm") {
      if (!state.lastfmUsername.trim()) {
        return "Enter your Last.fm username (link Spotify → Last.fm in the Spotify app first).";
      }
      return null;
    }
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
    const modes = normalizeScoringModes(state.scoringModes);
    if (
      modes.includes("chart_was_one") &&
      state.chartCountries.length < 1
    ) {
      return "Select at least one chart country.";
    }
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
    if (state.playMode === "auto_lastfm" || state.playMode === "auto_spotify") {
      const n = state.autoInterruptAfterEmptyRounds;
      if (!Number.isFinite(n) || n < 1 || n > 10) {
        return "Interrupt after empty songs must be between 1 and 10.";
      }
    }
    return null;
  }

  return null;
}

function playModeLabel(mode: QuizPlayMode): string {
  if (mode === "auto_lastfm") return "Live Spotify (Last.fm)";
  if (mode === "auto_spotify") return "Auto Spotify Connect";
  return "Curated playlist";
}

export function quizWizardSettingsSummary(state: CreateQuizWizardState): string {
  const mode = playModeLabel(state.playMode);
  const songs = filledQuizSongs(state).length;
  const modes = normalizeScoringModes(state.scoringModes);
  const scoring = modes.map(scoringModeLabel).join(" + ");
  const rangeBit = modes.includes("year_range")
    ? state.yearRangeTolerance === 0
      ? " · exact year = 1 yr"
      : ` · ±${state.yearRangeTolerance} years`
    : "";
  const chartsBit = modes.includes("chart_was_one")
    ? ` · Charts: ${state.chartCountries.join(", ") || "—"}`
    : "";
  const yearBasis =
    state.answerYearMode === "original_recording"
      ? "Original release year"
      : "Played Cover";
  const visibility = [
    state.showTitleArtist ? "title shown" : "title hidden",
    state.showCorrectAnswer ? "answer shown" : "answer hidden",
    state.presentLeaderboardAtEnd
      ? state.overallReveal === "last_to_first"
        ? "present leaderboard last-to-first"
        : "present leaderboard all at once"
      : state.showOverallResults
        ? "live leaderboard on"
        : "live leaderboard off",
    state.showResultDetails ? "result details on" : "result details off",
    state.showResultDetails
      ? state.showOthersInPastResults
        ? "others in past results on"
        : "others in past results off"
      : null,
  ]
    .filter(Boolean)
    .join(", ");
  const isLive =
    state.playMode === "auto_lastfm" || state.playMode === "auto_spotify";
  const autoBit = isLive
    ? ` · Auto-interrupt after ${state.autoInterruptAfterEmptyRounds} empty`
    : "";
  const lastfmBit =
    state.playMode === "auto_lastfm" && state.lastfmUsername.trim()
      ? ` · Last.fm @${state.lastfmUsername.trim().replace(/^@/, "")}`
      : "";
  if (isLive) {
    return `${mode}${lastfmBit} · ${yearBasis}${chartsBit} · Scoring: ${scoring}${rangeBit} · ${visibility}${autoBit}`;
  }
  return `${mode} · ${songs} song${songs === 1 ? "" : "s"} · ${yearBasis}${chartsBit} · Scoring: ${scoring}${rangeBit} · ${visibility}`;
}

type PersistedQuizWizardState = CreateQuizWizardState;

export function loadRememberedLastfmUsername(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem(LASTFM_USERNAME_STORAGE_KEY);
    if (!raw) return "";
    const trimmed = raw.trim().replace(/^@/, "");
    return trimmed;
  } catch {
    return "";
  }
}

/** Persists non-empty Last.fm usernames so they survive draft clear / quiz create. */
export function saveRememberedLastfmUsername(username: string): void {
  if (typeof window === "undefined") return;
  const normalized = username.trim().replace(/^@/, "");
  if (!normalized) return;
  try {
    window.localStorage.setItem(LASTFM_USERNAME_STORAGE_KEY, normalized);
  } catch {
    // ignore quota errors
  }
}

export function saveQuizWizardState(state: CreateQuizWizardState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CREATE_QUIZ_WIZARD_STORAGE_KEY,
      JSON.stringify(state satisfies PersistedQuizWizardState),
    );
    if (state.lastfmUsername.trim()) {
      saveRememberedLastfmUsername(state.lastfmUsername);
    }
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
    const loaded: CreateQuizWizardState = {
      ...base,
      ...parsed,
      playMode:
        parsed.playMode === "auto_lastfm" ||
        parsed.playMode === "auto_spotify" ||
        parsed.playMode === "curate"
          ? parsed.playMode
          : base.playMode,
      lastfmUsername:
        typeof parsed.lastfmUsername === "string"
          ? parsed.lastfmUsername
          : base.lastfmUsername,
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
      presentLeaderboardAtEnd: Boolean(
        parsed.presentLeaderboardAtEnd ??
          (parsed.overallReveal != null &&
            presentsLeaderboardAtEnd({
              overallReveal: parseOverallReveal(parsed.overallReveal),
            })),
      ),
      overallReveal: (() => {
        const mode = parseOverallReveal(parsed.overallReveal);
        return mode === "immediate" || mode === "last_to_first"
          ? mode
          : base.overallReveal;
      })(),
      autoInterruptAfterEmptyRounds: clampAutoInterruptAfterEmptyRounds(
        parsed.autoInterruptAfterEmptyRounds ??
          base.autoInterruptAfterEmptyRounds,
      ),
    };
    if (loaded.presentLeaderboardAtEnd) {
      loaded.showOverallResults = false;
    }
    return loaded;
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
