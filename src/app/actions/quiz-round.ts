"use server";

import { revalidatePath } from "next/cache";
import { addCuratedTrackToQuiz } from "@/lib/quiz-tracks";
import {
  closeRoundForHost,
  finishQuizForHost,
  startRoundForHost,
  submitGuessForMember,
} from "@/lib/quiz-play";
import {
  mergeQuizSettingsForStorage,
  readQuizSettingsRuntime,
  resolveQuizSettings,
} from "@/lib/quiz-scoring";
import { ensureAnonymousSession } from "@/lib/supabase/auth";
import { getQuizPlayState } from "@/lib/quizzes/play-state";
import type { SupabaseClient } from "@supabase/supabase-js";

export type QuizRoundActionState = {
  error?: string;
  ok?: boolean;
  /** Unique per successful action so clients can resync exactly once. */
  syncId?: string;
  /** Present after a successful guess — used for live host list patches. */
  guess?: {
    roundId: string;
    userId: string;
    guessedYear: number;
    guessedWasNumberOne: boolean | null;
  };
} | null;

function mapError(message: string): string {
  if (message.includes("NOT_HOST")) return "Only the host can do that.";
  if (message.includes("NOT_MEMBER")) return "You are not in this quiz.";
  if (message.includes("ROUND_ALREADY_ACTIVE")) return "A round is already active.";
  if (message.includes("CLOSE_ROUND_FIRST")) {
    return "Close the active round before finishing the quiz.";
  }
  if (message.includes("TRACK_LIMIT")) {
    const raw = message.split(":")[1];
    const n = Number(raw);
    const cap = Number.isFinite(n) && n > 0 ? n : 10;
    return `This quiz already has the maximum of ${cap} songs.`;
  }
  if (message.includes("NO_TRACK_AVAILABLE")) return "Add curated tracks before starting.";
  if (message.includes("ROUND_NOT_ACTIVE")) return "This round is not open for guesses.";
  if (message.includes("INVALID_YEAR")) {
    return `Enter a valid year between 1900 and ${new Date().getFullYear()}.`;
  }
  if (message.includes("QUIZ_FINISHED")) return "This quiz is already finished.";
  if (message.includes("QUIZ_EXPIRED")) return "This quiz has expired.";
  if (message.includes("QUIZ_NOT_JOINABLE")) return "This quiz cannot be changed right now.";
  return message || "Something went wrong.";
}

function okResult(): QuizRoundActionState {
  return { ok: true, syncId: crypto.randomUUID() };
}

/** After closing a round: update empty-guess streak; may set autoInterrupted. */
async function applyEmptyRoundStreak(
  admin: SupabaseClient,
  quizId: string,
  closedRoundId: string,
  rawSettings: unknown,
): Promise<{ interrupted: boolean; emptyStreak: number }> {
  const settings = resolveQuizSettings(rawSettings);
  const runtime = readQuizSettingsRuntime(rawSettings);
  const { count } = await admin
    .from("beatage_guesses")
    .select("id", { count: "exact", head: true })
    .eq("round_id", closedRoundId);

  const guessCount = count ?? 0;
  const emptyStreak =
    guessCount === 0 ? (runtime.autoEmptyStreak ?? 0) + 1 : 0;
  const threshold = settings.autoInterruptAfterEmptyRounds;
  const interrupted =
    Boolean(runtime.autoInterrupted) || emptyStreak >= threshold;

  await admin
    .from("beatage_quizzes")
    .update({
      settings: mergeQuizSettingsForStorage(settings, {
        autoEmptyStreak: emptyStreak,
        autoInterrupted: interrupted,
      }),
    })
    .eq("id", quizId);

  return { interrupted, emptyStreak };
}

async function clearAutoInterrupt(
  admin: SupabaseClient,
  quizId: string,
  rawSettings: unknown,
) {
  const settings = resolveQuizSettings(rawSettings);
  await admin
    .from("beatage_quizzes")
    .update({
      settings: mergeQuizSettingsForStorage(settings, {
        autoEmptyStreak: 0,
        autoInterrupted: false,
      }),
    })
    .eq("id", quizId);
}

/** Client live-sync snapshot (same admin-backed loader as the quiz page). */
export async function fetchQuizPlaySnapshotAction(quizId: string, joinCode: string) {
  const id = quizId.trim();
  const code = joinCode.trim().toUpperCase();
  if (!id || !code) return null;
  await ensureAnonymousSession();
  // Live polls must not re-run Spotify/iTunes backfill on every snapshot.
  return getQuizPlayState(id, code, { backfillReleaseYears: false });
}

export async function addCuratedTrackAction(
  _prev: QuizRoundActionState,
  formData: FormData,
): Promise<QuizRoundActionState> {
  const quizId = String(formData.get("quizId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();
  const trackName = String(formData.get("trackName") ?? "").trim();
  const artistName = String(formData.get("artistName") ?? "").trim();
  const previewUrl = String(formData.get("previewUrl") ?? "").trim();
  const spotifyTrackId = String(formData.get("spotifyTrackId") ?? "").trim();
  const releaseYearRaw = String(formData.get("releaseYear") ?? "").trim();
  const releaseYearParsed = Number(releaseYearRaw);
  const releaseYear =
    releaseYearRaw && Number.isFinite(releaseYearParsed) ? releaseYearParsed : null;

  if (!quizId || !trackName) {
    return { error: "Track title is required." };
  }

  const { user } = await ensureAnonymousSession();
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: quizRow } = await admin
    .from("beatage_quizzes")
    .select("status, host_user_id")
    .eq("id", quizId)
    .maybeSingle();
  if (!quizRow || quizRow.host_user_id !== user.id) {
    return { error: mapError("NOT_HOST") };
  }
  if (quizRow.status === "finished" || quizRow.status === "expired") {
    return { error: mapError("QUIZ_FINISHED") };
  }

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const trackResult = await addCuratedTrackToQuiz(supabase, quizId, {
    title: trackName,
    artist: artistName,
    previewUrl: previewUrl || undefined,
    spotifyTrackId: spotifyTrackId || undefined,
    releaseYear,
  });

  if (trackResult.error) return { error: mapError(trackResult.error) };

  revalidatePath(`/q/${joinCode}`);
  return okResult();
}

export async function startRoundAction(
  _prev: QuizRoundActionState,
  formData: FormData,
): Promise<QuizRoundActionState> {
  const quizId = String(formData.get("quizId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();

  if (!quizId) {
    return { error: "Missing quiz id." };
  }

  const curatedTrackId = String(formData.get("curatedTrackId") ?? "").trim() || null;

  // Prefer admin path — remote DB often lacks start_beatage_round (migration 003).
  const { user } = await ensureAnonymousSession();
  const result = await startRoundForHost(quizId, user.id, curatedTrackId);
  if (result.error) {
    return { error: mapError(result.error) };
  }

  revalidatePath(`/q/${joinCode}`);
  return okResult();
}

export async function submitGuessAction(
  _prev: QuizRoundActionState,
  formData: FormData,
): Promise<QuizRoundActionState> {
  const roundId = String(formData.get("roundId") ?? "").trim();
  const guessedYear = Number(formData.get("guessedYear"));
  const chartRaw = String(formData.get("guessedWasNumberOne") ?? "").trim();
  const guessedWasNumberOne =
    chartRaw === "true" ? true : chartRaw === "false" ? false : null;

  if (!roundId) {
    return { error: "Missing round id." };
  }

  const { user } = await ensureAnonymousSession();
  const result = await submitGuessForMember(
    roundId,
    user.id,
    guessedYear,
    guessedWasNumberOne,
  );
  if (result.error) {
    return { error: mapError(result.error) };
  }

  return {
    ...okResult(),
    guess: {
      roundId,
      userId: user.id,
      guessedYear,
      guessedWasNumberOne,
    },
  };
}

export async function closeRoundAction(
  _prev: QuizRoundActionState,
  formData: FormData,
): Promise<QuizRoundActionState> {
  const roundId = String(formData.get("roundId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();

  if (!roundId) {
    return { error: "Missing round id." };
  }

  const { user } = await ensureAnonymousSession();
  const result = await closeRoundForHost(roundId, user.id);
  if (result.error) {
    return { error: mapError(result.error) };
  }

  revalidatePath(`/q/${joinCode}`);
  return okResult();
}

export async function finishQuizAction(
  _prev: QuizRoundActionState,
  formData: FormData,
): Promise<QuizRoundActionState> {
  const quizId = String(formData.get("quizId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();

  if (!quizId) {
    return { error: "Missing quiz id." };
  }

  const { user } = await ensureAnonymousSession();
  const result = await finishQuizForHost(quizId, user.id);
  if (result.error) {
    return { error: mapError(result.error) };
  }

  revalidatePath(`/q/${joinCode}`);
  revalidatePath("/");
  return okResult();
}

export type AutoSpotifySyncState = {
  ok?: boolean;
  error?: string;
  code?: string;
  trackId?: string;
  trackTitle?: string;
  trackArtist?: string;
  closedRound?: boolean;
  startedRound?: boolean;
  nothingPlaying?: boolean;
  /** Auto Spotify paused after consecutive empty rounds. */
  interrupted?: boolean;
  emptyStreak?: number;
};

/** Close active round if needed, ensure curated track exists, start round for now-playing. */
export async function syncAutoSpotifyRoundAction(
  quizId: string,
  joinCode: string,
  opts?: { forceClose?: boolean; openNewRound?: boolean },
): Promise<AutoSpotifySyncState> {
  const id = quizId.trim();
  const code = joinCode.trim().toUpperCase();
  if (!id) return { error: "Missing quiz id." };

  const openNewRound = opts?.openNewRound !== false;

  const { user } = await ensureAnonymousSession();
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();

  const { data: quizRow } = await admin
    .from("beatage_quizzes")
    .select("host_user_id, status, settings")
    .eq("id", id)
    .maybeSingle();
  if (!quizRow || quizRow.host_user_id !== user.id) {
    return { error: mapError("NOT_HOST") };
  }
  if (quizRow.status === "finished" || quizRow.status === "expired") {
    return { error: mapError("QUIZ_FINISHED") };
  }

  let rawSettings = (quizRow as { settings?: unknown }).settings;
  const runtime = readQuizSettingsRuntime(rawSettings);
  if (runtime.autoInterrupted && openNewRound) {
    return {
      ok: true,
      interrupted: true,
      emptyStreak: runtime.autoEmptyStreak ?? 0,
      startedRound: false,
      closedRound: false,
    };
  }

  const { getCurrentlyPlayingForUser } = await import("@/lib/spotify-connect");
  const nowPlaying = await getCurrentlyPlayingForUser();
  if (!nowPlaying.ok) {
    return { error: nowPlaying.message, code: nowPlaying.code };
  }
  if (!nowPlaying.playing) {
    if (opts?.forceClose) {
      const { data: active } = await admin
        .from("beatage_rounds")
        .select("id")
        .eq("quiz_id", id)
        .eq("status", "active")
        .maybeSingle();
      if (active?.id) {
        const closed = await closeRoundForHost(active.id, user.id);
        if (closed.error) return { error: mapError(closed.error) };
        const streak = await applyEmptyRoundStreak(
          admin,
          id,
          active.id,
          rawSettings,
        );
        const { data: refreshed } = await admin
          .from("beatage_quizzes")
          .select("settings")
          .eq("id", id)
          .maybeSingle();
        rawSettings = refreshed?.settings ?? rawSettings;
        revalidatePath(`/q/${code}`);
        return {
          ok: true,
          closedRound: true,
          nothingPlaying: true,
          interrupted: streak.interrupted,
          emptyStreak: streak.emptyStreak,
        };
      }
    }
    return { ok: true, nothingPlaying: true };
  }

  const track = nowPlaying.track;

  const { data: active } = await admin
    .from("beatage_rounds")
    .select("id, spotify_track_id")
    .eq("quiz_id", id)
    .eq("status", "active")
    .maybeSingle();

  let closedRound = false;
  let interrupted = Boolean(runtime.autoInterrupted);
  let emptyStreak = runtime.autoEmptyStreak ?? 0;
  if (active?.id) {
    const sameTrack = active.spotify_track_id === track.spotifyTrackId;
    if (!sameTrack || opts?.forceClose) {
      const closed = await closeRoundForHost(active.id, user.id);
      if (closed.error) return { error: mapError(closed.error) };
      closedRound = true;
      const streak = await applyEmptyRoundStreak(
        admin,
        id,
        active.id,
        rawSettings,
      );
      interrupted = streak.interrupted;
      emptyStreak = streak.emptyStreak;
      const { data: refreshed } = await admin
        .from("beatage_quizzes")
        .select("settings")
        .eq("id", id)
        .maybeSingle();
      rawSettings = refreshed?.settings ?? rawSettings;
    } else if (!openNewRound) {
      return {
        ok: true,
        trackTitle: track.title,
        trackArtist: track.artist,
        startedRound: false,
        closedRound: false,
      };
    } else {
      // Already guessing this track.
      return {
        ok: true,
        trackTitle: track.title,
        trackArtist: track.artist,
        startedRound: false,
        closedRound: false,
      };
    }
  }

  if (!openNewRound) {
    revalidatePath(`/q/${code}`);
    return {
      ok: true,
      trackTitle: track.title,
      trackArtist: track.artist,
      closedRound,
      startedRound: false,
      interrupted,
      emptyStreak,
    };
  }

  if (interrupted) {
    revalidatePath(`/q/${code}`);
    return {
      ok: true,
      trackTitle: track.title,
      trackArtist: track.artist,
      closedRound,
      startedRound: false,
      interrupted: true,
      emptyStreak,
    };
  }

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const addResult = await addCuratedTrackToQuiz(supabase, id, {
    title: track.title,
    artist: track.artist,
    spotifyTrackId: track.spotifyTrackId,
    releaseYear: track.releaseYear,
    albumArtUrl: track.albumArtUrl ?? undefined,
  });
  if (addResult.error) {
    return { error: mapError(addResult.error) };
  }
  const curatedTrackId = addResult.trackId;
  if (!curatedTrackId) {
    return { error: "Could not save the Spotify track to this quiz." };
  }

  const started = await startRoundForHost(id, user.id, curatedTrackId);
  if (started.error) {
    return { error: mapError(started.error) };
  }

  revalidatePath(`/q/${code}`);
  return {
    ok: true,
    trackId: curatedTrackId,
    trackTitle: track.title,
    trackArtist: track.artist,
    closedRound,
    startedRound: true,
    interrupted: false,
    emptyStreak,
  };
}

/** Host clears Auto Spotify empty-round interrupt and resumes ingest. */
export async function resumeAutoSpotifyQuizAction(
  quizId: string,
  joinCode: string,
): Promise<AutoSpotifySyncState> {
  const id = quizId.trim();
  const code = joinCode.trim().toUpperCase();
  if (!id) return { error: "Missing quiz id." };

  const { user } = await ensureAnonymousSession();
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: quizRow } = await admin
    .from("beatage_quizzes")
    .select("host_user_id, settings")
    .eq("id", id)
    .maybeSingle();
  if (!quizRow || quizRow.host_user_id !== user.id) {
    return { error: mapError("NOT_HOST") };
  }

  await clearAutoInterrupt(admin, id, quizRow.settings);
  revalidatePath(`/q/${code}`);
  return { ok: true, interrupted: false, emptyStreak: 0 };
}

export async function skipSpotifyNextAction(
  quizId: string,
  joinCode: string,
): Promise<AutoSpotifySyncState> {
  const { user } = await ensureAnonymousSession();
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: quizRow } = await admin
    .from("beatage_quizzes")
    .select("host_user_id")
    .eq("id", quizId.trim())
    .maybeSingle();
  if (!quizRow || quizRow.host_user_id !== user.id) {
    return { error: mapError("NOT_HOST") };
  }

  const { skipToNextSpotifyTrackForUser } = await import("@/lib/spotify-connect");
  const skipped = await skipToNextSpotifyTrackForUser();
  if (!skipped.ok) {
    return { error: skipped.message, code: skipped.code };
  }
  return { ok: true };
}

