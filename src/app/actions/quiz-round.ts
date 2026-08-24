"use server";

import { revalidatePath } from "next/cache";
import { addCuratedTrackToQuiz } from "@/lib/quiz-tracks";
import {
  closeRoundForHost,
  finishQuizForHost,
  startRoundForHost,
  submitGuessForMember,
} from "@/lib/quiz-play";
import { ensureAnonymousSession } from "@/lib/supabase/auth";
import { getQuizPlayState } from "@/lib/quizzes/play-state";

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

  if (!roundId) {
    return { error: "Missing round id." };
  }

  const { user } = await ensureAnonymousSession();
  const result = await submitGuessForMember(roundId, user.id, guessedYear);
  if (result.error) {
    return { error: mapError(result.error) };
  }

  return {
    ...okResult(),
    guess: {
      roundId,
      userId: user.id,
      guessedYear,
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
        revalidatePath(`/q/${code}`);
        return { ok: true, closedRound: true, nothingPlaying: true };
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
  if (active?.id) {
    const sameTrack = active.spotify_track_id === track.spotifyTrackId;
    if (!sameTrack || opts?.forceClose) {
      const closed = await closeRoundForHost(active.id, user.id);
      if (closed.error) return { error: mapError(closed.error) };
      closedRound = true;
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
  };
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

