"use server";

import { revalidatePath } from "next/cache";
import { addCuratedTrackToQuiz } from "@/lib/quiz-tracks";
import {
  closeRoundForHost,
  finishQuizForHost,
  advanceLeaderboardRevealForHost,
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
    return `TRACK_LIMIT:${cap}`;
  }
  if (message.includes("ROUND_LIMIT")) {
    const raw = message.split(":")[1];
    const n = Number(raw);
    const cap = Number.isFinite(n) && n > 0 ? n : 10;
    return `ROUND_LIMIT:${cap}`;
  }
  if (message.includes("NO_TRACK_AVAILABLE")) return "Add curated tracks before starting.";
  if (message.includes("ROUND_NOT_ACTIVE")) return "This round is not open for guesses.";
  if (message.includes("INVALID_YEAR")) {
    return `Enter a valid year between 1900 and ${new Date().getFullYear()}.`;
  }
  if (message.includes("QUIZ_FINISHED")) return "This quiz is already finished.";
  if (message.includes("QUIZ_NOT_FINISHED")) {
    return "Finish the quiz before presenting the leaderboard.";
  }
  if (message.includes("NO_LEADERBOARD_PRESENTATION")) {
    return "This quiz does not use a leaderboard presentation.";
  }
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
    .eq("round_id", closedRoundId)
    .not("guessed_year", "is", null);

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
        ...runtime,
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
  const runtime = readQuizSettingsRuntime(rawSettings);
  await admin
    .from("beatage_quizzes")
    .update({
      settings: mergeQuizSettingsForStorage(settings, {
        ...runtime,
        autoEmptyStreak: 0,
        autoInterrupted: false,
      }),
    })
    .eq("id", quizId);
}

async function forceAutoInterrupted(
  admin: SupabaseClient,
  quizId: string,
  rawSettings: unknown,
) {
  const settings = resolveQuizSettings(rawSettings);
  const runtime = readQuizSettingsRuntime(rawSettings);
  await admin
    .from("beatage_quizzes")
    .update({
      settings: mergeQuizSettingsForStorage(settings, {
        ...runtime,
        autoInterrupted: true,
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

export async function advanceLeaderboardRevealAction(
  _prev: QuizRoundActionState,
  formData: FormData,
): Promise<QuizRoundActionState> {
  const quizId = String(formData.get("quizId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();

  if (!quizId) {
    return { error: "Missing quiz id." };
  }

  const { user } = await ensureAnonymousSession();
  const result = await advanceLeaderboardRevealForHost(quizId, user.id);
  if (result.error) {
    return { error: mapError(result.error) };
  }

  revalidatePath(`/q/${joinCode}`);
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

/** Host-polled now-playing — avoids a second Last.fm fetch in the sync action. */
export type LastfmNowPlayingHint =
  | { playing: false }
  | { playing: true; title: string; artist: string; albumArtUrl?: string | null };

/** Host-polled now-playing — avoids a second Spotify fetch in the sync action. */
export type SpotifyNowPlayingHint =
  | { playing: false }
  | {
      playing: true;
      spotifyTrackId: string;
      title: string;
      artist: string;
      albumArtUrl?: string | null;
      releaseYear?: number | null;
      isPlaying?: boolean;
    };

function parseLastfmNowPlayingHint(
  hint: LastfmNowPlayingHint | undefined,
):
  | { playing: false }
  | {
      playing: true;
      title: string;
      artist: string;
      albumArtUrl: string | null;
    }
  | null {
  if (!hint) return null;
  if (hint.playing === false) return { playing: false };
  const title = hint.title.trim().slice(0, 200);
  const artist = hint.artist.trim().slice(0, 200);
  if (!title || !artist) return null;
  const albumArtUrl =
    typeof hint.albumArtUrl === "string" && hint.albumArtUrl.trim()
      ? hint.albumArtUrl.trim().slice(0, 500)
      : null;
  return { playing: true, title, artist, albumArtUrl };
}

function parseSpotifyNowPlayingHint(
  hint: SpotifyNowPlayingHint | undefined,
):
  | { playing: false }
  | {
      playing: true;
      spotifyTrackId: string;
      title: string;
      artist: string;
      albumArtUrl: string | null;
      releaseYear: number | null;
      isPlaying: boolean;
    }
  | null {
  if (!hint) return null;
  if (hint.playing === false) return { playing: false };
  const spotifyTrackId = hint.spotifyTrackId.trim();
  if (!/^[A-Za-z0-9]{10,32}$/.test(spotifyTrackId)) return null;
  const title = hint.title.trim().slice(0, 200);
  const artist = hint.artist.trim().slice(0, 200);
  if (!title || !artist) return null;
  const albumArtUrl =
    typeof hint.albumArtUrl === "string" && hint.albumArtUrl.trim()
      ? hint.albumArtUrl.trim().slice(0, 500)
      : null;
  const year = hint.releaseYear;
  const releaseYear =
    typeof year === "number" && Number.isFinite(year) && year >= 1900 && year <= 2100
      ? Math.trunc(year)
      : null;
  return {
    playing: true,
    spotifyTrackId,
    title,
    artist,
    albumArtUrl,
    releaseYear,
    isPlaying: hint.isPlaying !== false,
  };
}

/** Close active round if needed, ensure curated track exists, start round for now-playing. */
export async function syncAutoSpotifyRoundAction(
  quizId: string,
  joinCode: string,
  opts?: {
    forceClose?: boolean;
    openNewRound?: boolean;
    nowPlaying?: SpotifyNowPlayingHint;
  },
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
  const hinted = parseSpotifyNowPlayingHint(opts?.nowPlaying);
  // Close-only: no Spotify round-trip — host already decided from the poll.
  if (opts?.forceClose && !openNewRound && hinted?.playing !== true) {
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
      revalidatePath(`/q/${code}`);
      return {
        ok: true,
        closedRound: true,
        nothingPlaying: hinted?.playing === false,
        interrupted: streak.interrupted,
        emptyStreak: streak.emptyStreak,
      };
    }
    return { ok: true, nothingPlaying: true };
  }

  let nowPlaying: Awaited<ReturnType<typeof getCurrentlyPlayingForUser>>;
  if (hinted) {
    nowPlaying = hinted.playing
      ? {
          ok: true,
          playing: true,
          track: {
            isPlaying: hinted.isPlaying,
            spotifyTrackId: hinted.spotifyTrackId,
            title: hinted.title,
            artist: hinted.artist,
            albumArtUrl: hinted.albumArtUrl,
            releaseYear: hinted.releaseYear,
            progressMs: 0,
            durationMs: 0,
          },
        }
      : { ok: true, playing: false };
  } else {
    nowPlaying = await getCurrentlyPlayingForUser();
  }
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

/** Host closes the active round and pauses Auto Spotify (manual interrupt). */
export async function interruptAutoSpotifyQuizAction(
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
  let closedRound = false;

  const { data: active } = await admin
    .from("beatage_rounds")
    .select("id")
    .eq("quiz_id", id)
    .eq("status", "active")
    .maybeSingle();

  if (active?.id) {
    const closed = await closeRoundForHost(active.id, user.id);
    if (closed.error) return { error: mapError(closed.error) };
    closedRound = true;
    await applyEmptyRoundStreak(admin, id, active.id, rawSettings);
    const { data: refreshed } = await admin
      .from("beatage_quizzes")
      .select("settings")
      .eq("id", id)
      .maybeSingle();
    rawSettings = refreshed?.settings ?? rawSettings;
  }

  await forceAutoInterrupted(admin, id, rawSettings);
  revalidatePath(`/q/${code}`);
  return { ok: true, closedRound, interrupted: true };
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

/** Close active round if needed, add track from Last.fm now-playing, start round. */
export async function syncLastfmLiveRoundAction(
  quizId: string,
  joinCode: string,
  opts?: {
    forceClose?: boolean;
    openNewRound?: boolean;
    nowPlaying?: LastfmNowPlayingHint;
  },
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
    .select("host_user_id, status, settings, source")
    .eq("id", id)
    .maybeSingle();
  if (!quizRow || quizRow.host_user_id !== user.id) {
    return { error: mapError("NOT_HOST") };
  }
  if (quizRow.status === "finished" || quizRow.status === "expired") {
    return { error: mapError("QUIZ_FINISHED") };
  }
  if (quizRow.source !== "lastfm_live") {
    return { error: "This quiz is not in Last.fm live mode." };
  }

  let rawSettings = (quizRow as { settings?: unknown }).settings;
  const runtime = readQuizSettingsRuntime(rawSettings);
  const settings = resolveQuizSettings(rawSettings);
  if (runtime.autoInterrupted && openNewRound) {
    return {
      ok: true,
      interrupted: true,
      emptyStreak: runtime.autoEmptyStreak ?? 0,
      startedRound: false,
      closedRound: false,
    };
  }

  const { getLastfmCurrentlyPlaying, lastfmTrackKey } = await import("@/lib/lastfm");
  const hinted = parseLastfmNowPlayingHint(opts?.nowPlaying);
  // Close-only: no Last.fm round-trip — host already decided from the poll.
  if (opts?.forceClose && !openNewRound && hinted?.playing !== true) {
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
      revalidatePath(`/q/${code}`);
      return {
        ok: true,
        closedRound: true,
        nothingPlaying: hinted?.playing === false,
        interrupted: streak.interrupted,
        emptyStreak: streak.emptyStreak,
      };
    }
    return { ok: true, nothingPlaying: true };
  }

  let nowPlaying: Awaited<ReturnType<typeof getLastfmCurrentlyPlaying>>;
  if (hinted) {
    nowPlaying = hinted.playing
      ? {
          ok: true,
          playing: true,
          track: {
            trackKey: lastfmTrackKey(hinted.title, hinted.artist),
            title: hinted.title,
            artist: hinted.artist,
            albumArtUrl: hinted.albumArtUrl,
            isPlaying: true,
          },
        }
      : { ok: true, playing: false };
  } else {
    nowPlaying = await getLastfmCurrentlyPlaying(settings.lastfmUsername);
  }
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
    .select("id, track_name, artist_name")
    .eq("quiz_id", id)
    .eq("status", "active")
    .maybeSingle();

  let closedRound = false;
  let interrupted = Boolean(runtime.autoInterrupted);
  let emptyStreak = runtime.autoEmptyStreak ?? 0;
  if (active?.id) {
    const activeKey = lastfmTrackKey(
      String(active.track_name ?? ""),
      String(active.artist_name ?? ""),
    );
    const sameTrack = activeKey === track.trackKey;
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
    } else {
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
    albumArtUrl: track.albumArtUrl ?? undefined,
  });
  if (addResult.error) {
    return { error: mapError(addResult.error) };
  }
  const curatedTrackId = addResult.trackId;
  if (!curatedTrackId) {
    return { error: "Could not save the track to this quiz." };
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

/** Host updates the Last.fm username stored on a lastfm_live quiz. */
export async function updateLastfmUsernameAction(
  quizId: string,
  joinCode: string,
  username: string,
): Promise<AutoSpotifySyncState> {
  const id = quizId.trim();
  const code = joinCode.trim().toUpperCase();
  if (!id) return { error: "Missing quiz id." };

  const { normalizeLastfmUsername } = await import("@/lib/lastfm");
  const lastfmUsername = normalizeLastfmUsername(username);
  if (!lastfmUsername) {
    return { error: "Enter your Last.fm username." };
  }

  const { user } = await ensureAnonymousSession();
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: quizRow } = await admin
    .from("beatage_quizzes")
    .select("host_user_id, settings, source")
    .eq("id", id)
    .maybeSingle();
  if (!quizRow || quizRow.host_user_id !== user.id) {
    return { error: mapError("NOT_HOST") };
  }
  if (quizRow.source !== "lastfm_live") {
    return { error: "This quiz is not in Last.fm live mode." };
  }

  const settings = resolveQuizSettings(quizRow.settings);
  const runtime = readQuizSettingsRuntime(quizRow.settings);
  await admin
    .from("beatage_quizzes")
    .update({
      settings: mergeQuizSettingsForStorage(
        { ...settings, lastfmUsername },
        runtime,
      ),
    })
    .eq("id", id);

  revalidatePath(`/q/${code}`);
  return { ok: true };
}

