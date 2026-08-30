import type { SupabaseClient } from "@supabase/supabase-js";
import { lastfmTrackKey } from "@/lib/lastfm";
import {
  mergeQuizSettingsForStorage,
  readQuizSettingsRuntime,
  resolveQuizSettings,
} from "@/lib/quiz-scoring";
import { isPreRoundNumber, type QuizSettingsRuntime } from "@/lib/quiz-settings";

export async function patchQuizRuntimeSettings(
  admin: SupabaseClient,
  quizId: string,
  rawSettings: unknown,
  patch: QuizSettingsRuntime,
): Promise<unknown> {
  const settings = resolveQuizSettings(rawSettings);
  const runtime = readQuizSettingsRuntime(rawSettings);
  const next = mergeQuizSettingsForStorage(settings, { ...runtime, ...patch });
  await admin
    .from("beatage_quizzes")
    .update({ settings: next })
    .eq("id", quizId);
  return next;
}

/** After closing a round: update empty-guess streak; may set autoInterrupted. */
export async function applyEmptyRoundStreak(
  admin: SupabaseClient,
  quizId: string,
  closedRoundId: string,
  rawSettings: unknown,
): Promise<{ interrupted: boolean; emptyStreak: number }> {
  const settings = resolveQuizSettings(rawSettings);
  const runtime = readQuizSettingsRuntime(rawSettings);

  // Pre-rounds are practice — do not count toward the empty-streak interrupt.
  const { data: closedRound } = await admin
    .from("beatage_rounds")
    .select("round_number")
    .eq("id", closedRoundId)
    .maybeSingle();
  const closedRoundNumber =
    typeof (closedRound as { round_number?: number } | null)?.round_number ===
    "number"
      ? (closedRound as { round_number: number }).round_number
      : 0;
  if (isPreRoundNumber(closedRoundNumber, runtime)) {
    return {
      interrupted: Boolean(runtime.autoInterrupted),
      emptyStreak: runtime.autoEmptyStreak ?? 0,
    };
  }

  const { count } = await admin
    .from("beatage_guesses")
    .select("id", { count: "exact", head: true })
    .eq("round_id", closedRoundId)
    .not("guessed_year", "is", null);

  const guessCount = count ?? 0;
  const emptyStreak =
    guessCount === 0 ? (runtime.autoEmptyStreak ?? 0) + 1 : 0;
  const threshold = settings.autoInterruptAfterEmptyRounds;
  const interrupted =
    Boolean(runtime.autoInterrupted) || emptyStreak >= threshold;

  await patchQuizRuntimeSettings(admin, quizId, rawSettings, {
    autoEmptyStreak: emptyStreak,
    autoInterrupted: interrupted,
    ...(interrupted ? { liveSyncEnabled: false } : {}),
  });

  return { interrupted, emptyStreak };
}

export async function clearAutoInterrupt(
  admin: SupabaseClient,
  quizId: string,
  rawSettings: unknown,
) {
  await patchQuizRuntimeSettings(admin, quizId, rawSettings, {
    autoEmptyStreak: 0,
    autoInterrupted: false,
  });
}

export async function forceAutoInterrupted(
  admin: SupabaseClient,
  quizId: string,
  rawSettings: unknown,
) {
  await patchQuizRuntimeSettings(admin, quizId, rawSettings, {
    autoInterrupted: true,
    liveSyncEnabled: false,
  });
}

export async function persistLastfmDeferredTrackKey(
  admin: SupabaseClient,
  quizId: string,
  rawSettings: unknown,
  title: string | null | undefined,
  artist: string | null | undefined,
) {
  const key = lastfmTrackKey(String(title ?? ""), String(artist ?? ""));
  if (!key || key === "lfm:|") return;
  await patchQuizRuntimeSettings(admin, quizId, rawSettings, {
    liveDeferredTrackKey: key,
  });
}
