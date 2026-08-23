import type { ChartCountryCode, ScoringModeId } from "@/lib/quiz-settings";
import { DEFAULT_QUIZ_SETTINGS } from "@/lib/quiz-settings";

export const CREATE_QUIZ_WIZARD_STORAGE_KEY = "beatage.create-quiz-wizard.v1";

export type DraftQuizSong = {
  title: string;
  artist: string;
  previewUrl: string;
};

export type CreateQuizWizardState = {
  step: number;
  hostName: string;
  title: string;
  description: string;
  draftSongs: DraftQuizSong[];
  chartCountries: ChartCountryCode[];
  scoringModes: ScoringModeId[];
  hostParticipates: boolean;
};

export const QUIZ_WIZARD_STEP_TITLES = [
  "Setup",
  "Curate playlist",
  "Quiz options",
  "Review",
] as const;

export function defaultQuizWizardState(hostName = ""): CreateQuizWizardState {
  return {
    step: 0,
    hostName: hostName.trim(),
    title: "",
    description: "",
    draftSongs: [{ title: "", artist: "", previewUrl: "" }],
    chartCountries: [...DEFAULT_QUIZ_SETTINGS.chartCountries],
    scoringModes: [...DEFAULT_QUIZ_SETTINGS.scoringModes],
    hostParticipates: DEFAULT_QUIZ_SETTINGS.hostParticipates,
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
    if (state.scoringModes.length < 1) return "Select at least one scoring mode.";
    return null;
  }

  return null;
}

export function quizWizardSettingsSummary(state: CreateQuizWizardState): string {
  const songs = filledQuizSongs(state).length;
  const countries = state.chartCountries.join(", ");
  const scoring = state.scoringModes.join(", ");
  return `${songs} song${songs === 1 ? "" : "s"} · Charts: ${countries} · Scoring: ${scoring}`;
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
      draftSongs:
        Array.isArray(parsed.draftSongs) && parsed.draftSongs.length > 0
          ? parsed.draftSongs.map((song) => ({
              title: String(song?.title ?? ""),
              artist: String(song?.artist ?? ""),
              previewUrl: String(song?.previewUrl ?? ""),
            }))
          : base.draftSongs,
      chartCountries:
        Array.isArray(parsed.chartCountries) && parsed.chartCountries.length > 0
          ? (parsed.chartCountries as ChartCountryCode[])
          : base.chartCountries,
      scoringModes:
        Array.isArray(parsed.scoringModes) && parsed.scoringModes.length > 0
          ? (parsed.scoringModes as ScoringModeId[])
          : base.scoringModes,
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
