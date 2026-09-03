"use server";

import { revalidatePath } from "next/cache";
import { addCuratedTrackToQuiz } from "@/lib/quiz-tracks";
import {
  closeRoundForHost,
  excludeRoundFromScoringForHost,
  finishQuizForHost,
  advanceLeaderboardRevealForHost,
  includeRoundInScoringForHost,
  skipRoundForHost,
  startOfficialQuizForHost,
  startRoundForHost,
  submitGuessForMember,
} from "@/lib/quiz-play";
import {
  isRoundAlreadyClosedError,
  resolveActiveRound,
} from "@/lib/quiz-active-round";
import {
  mergeQuizSettingsForStorage,
  readQuizSettingsRuntime,
  resolveQuizSettings,
} from "@/lib/quiz-scoring";
import {
  applyEmptyRoundStreak,
  clearAutoInterrupt,
  forceAutoInterrupted,
  persistLastfmDeferredTrackKey,
  patchQuizRuntimeSettings,
} from "@/lib/quiz-live-runtime";
import {
  armLastfmLiveSync,
  syncLastfmLiveQuiz,
  type LastfmNowPlayingHint,
} from "@/lib/lastfm-live-sync";
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
  if (message.includes("ROUND_NOT_SCORABLE")) {
    return "Only completed rounds can be excluded from scoring.";
  }
  if (message.includes("ROUND_NOT_EXCLUDED")) {
    return "This round is not excluded from scoring.";
  }
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
  if (message.includes("NOT_LIVE_QUIZ")) {
    return "Start Quiz Now is only available for live quizzes.";
  }
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

/** Host ends pre-round warm-up; next song or the current song becomes Round 1. */
export async function startOfficialQuizAction(
  quizId: string,
  joinCode: string,
  opts?: { includeCurrentSong?: boolean; deferredTrackKey?: string | null },
): Promise<{
  ok?: boolean;
  error?: string;
  closedRound?: boolean;
  promotedRound?: boolean;
}> {
  const id = quizId.trim();
  const code = joinCode.trim().toUpperCase();
  if (!id) return { error: "Missing quiz id." };

  const { user } = await ensureAnonymousSession();
  const result = await startOfficialQuizForHost(id, user.id, opts);
  if (result.error) {
    return { error: mapError(result.error) };
  }
  revalidatePath(`/q/${code}`);
  return {
    ok: true,
    closedRound: result.closedRound,
    promotedRound: result.promotedRound,
  };
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

export async function skipRoundAction(
  _prev: QuizRoundActionState,
  formData: FormData,
): Promise<QuizRoundActionState> {
  const roundId = String(formData.get("roundId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();

  if (!roundId) {
    return { error: "Missing round id." };
  }

  const { user } = await ensureAnonymousSession();
  const result = await skipRoundForHost(roundId, user.id);
  if (result.error) {
    return { error: mapError(result.error) };
  }

  revalidatePath(`/q/${joinCode}`);
  return okResult();
}

export async function excludeRoundAction(
  _prev: QuizRoundActionState,
  formData: FormData,
): Promise<QuizRoundActionState> {
  const roundId = String(formData.get("roundId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();

  if (!roundId) {
    return { error: "Missing round id." };
  }

  const { user } = await ensureAnonymousSession();
  const result = await excludeRoundFromScoringForHost(roundId, user.id);
  if (result.error) {
    return { error: mapError(result.error) };
  }

  revalidatePath(`/q/${joinCode}`);
  return okResult();
}

export async function includeRoundAction(
  _prev: QuizRoundActionState,
  formData: FormData,
): Promise<QuizRoundActionState> {
  const roundId = String(formData.get("roundId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();

  if (!roundId) {
    return { error: "Missing round id." };
  }

  const { user } = await ensureAnonymousSession();
  const result = await includeRoundInScoringForHost(roundId, user.id);
  if (result.error) {
    return { error: mapError(result.error) };
  }

  revalidatePath(`/q/${joinCode}`);
  return okResult();
}

/** Skip the active round (live host controls with defer / player advance). */
export async function skipActiveRoundAction(
  quizId: string,
  joinCode: string,
  opts?: { advanceSpotify?: boolean },
): Promise<AutoSpotifySyncState> {
  const id = quizId.trim();
  const code = joinCode.trim().toUpperCase();
  if (!id) return { error: "Missing quiz id." };

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

  const active = await resolveActiveRound(id);

  if (!active?.id) {
    return { error: "This round is not open for guesses." };
  }

  if (quizRow.source === "lastfm_live") {
    await persistLastfmDeferredTrackKey(
      admin,
      id,
      quizRow.settings,
      active.track_name,
      active.artist_name,
    );
  }

  const skipped = await skipRoundForHost(active.id, user.id);
  if (skipped.error) {
    return { error: mapError(skipped.error) };
  }

  if (opts?.advanceSpotify) {
    const { skipToNextSpotifyTrackForUser } = await import("@/lib/spotify-connect");
    const advanced = await skipToNextSpotifyTrackForUser();
    if (!advanced.ok) {
      return { error: advanced.message, code: advanced.code };
    }
  }

  revalidatePath(`/q/${code}`);
  return { ok: true, closedRound: true };
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
    const active = await resolveActiveRound(id);
    if (active?.id) {
      const closed = await closeRoundForHost(active.id, user.id);
      if (closed.error && !isRoundAlreadyClosedError(closed.error)) {
        return { error: mapError(closed.error) };
      }
      if (!closed.error) {
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
      const active = await resolveActiveRound(id);
      if (active?.id) {
        const closed = await closeRoundForHost(active.id, user.id);
        if (closed.error && !isRoundAlreadyClosedError(closed.error)) {
          return { error: mapError(closed.error) };
        }
        if (!closed.error) {
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
    }
    return { ok: true, nothingPlaying: true };
  }

  const track = nowPlaying.track;

  const active = await resolveActiveRound(id);

  let closedRound = false;
  let interrupted = Boolean(runtime.autoInterrupted);
  let emptyStreak = runtime.autoEmptyStreak ?? 0;
  if (active?.id) {
    const sameTrack = active.spotify_track_id === track.spotifyTrackId;
    if (!sameTrack || opts?.forceClose) {
      const closed = await closeRoundForHost(active.id, user.id);
      if (closed.error && !isRoundAlreadyClosedError(closed.error)) {
        return { error: mapError(closed.error) };
      }
      closedRound = !closed.error;
      if (!closed.error) {
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
      }
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

  if (track.isPlaying === false) {
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
    .select("host_user_id, status, settings, source")
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

  const active = await resolveActiveRound(id);

  if (active?.id) {
    if (quizRow.source === "lastfm_live") {
      await persistLastfmDeferredTrackKey(
        admin,
        id,
        rawSettings,
        active.track_name,
        active.artist_name,
      );
      const { data: afterDefer } = await admin
        .from("beatage_quizzes")
        .select("settings")
        .eq("id", id)
        .maybeSingle();
      rawSettings = afterDefer?.settings ?? rawSettings;
    }
    const closed = await closeRoundForHost(active.id, user.id);
    if (closed.error && !isRoundAlreadyClosedError(closed.error)) {
      return { error: mapError(closed.error) };
    }
    closedRound = !closed.error;
    if (!closed.error) {
      await applyEmptyRoundStreak(admin, id, active.id, rawSettings);
      const { data: refreshed } = await admin
        .from("beatage_quizzes")
        .select("settings")
        .eq("id", id)
        .maybeSingle();
      rawSettings = refreshed?.settings ?? rawSettings;
    }
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
    .select("host_user_id, settings, source")
    .eq("id", id)
    .maybeSingle();
  if (!quizRow || quizRow.host_user_id !== user.id) {
    return { error: mapError("NOT_HOST") };
  }

  await clearAutoInterrupt(admin, id, quizRow.settings);
  if (quizRow.source === "lastfm_live") {
    const { data: refreshed } = await admin
      .from("beatage_quizzes")
      .select("settings")
      .eq("id", id)
      .maybeSingle();
    await armLastfmLiveSync(admin, id, refreshed?.settings ?? quizRow.settings, {
      resetTimer: true,
    });
  }
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

  const { user } = await ensureAnonymousSession();
  return syncLastfmLiveQuiz({
    quizId: id,
    joinCode: code,
    hostUserId: user.id,
    source: "host",
    forceClose: opts?.forceClose,
    openNewRound: opts?.openNewRound,
    nowPlaying: opts?.nowPlaying,
  });
}

/** Persist Last.fm live cron flags (arm, skip-lock, listen mode). */
export async function patchLastfmLiveRuntimeAction(
  quizId: string,
  joinCode: string,
  patch: {
    liveSyncEnabled?: boolean;
    liveDeferredTrackKey?: string | null;
    liveOpenMode?: "automatic" | "manual";
  },
): Promise<AutoSpotifySyncState> {
  const id = quizId.trim();
  const code = joinCode.trim().toUpperCase();
  if (!id) return { error: "Missing quiz id." };

  const { user } = await ensureAnonymousSession();
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: quizRow } = await admin
    .from("beatage_quizzes")
    .select("host_user_id, settings, source, status")
    .eq("id", id)
    .maybeSingle();
  if (!quizRow || quizRow.host_user_id !== user.id) {
    return { error: mapError("NOT_HOST") };
  }
  if (quizRow.source !== "lastfm_live") {
    return { error: "This quiz is not in Last.fm live mode." };
  }
  if (quizRow.status === "finished" || quizRow.status === "expired") {
    return { error: mapError("QUIZ_FINISHED") };
  }

  if (patch.liveSyncEnabled) {
    await armLastfmLiveSync(admin, id, quizRow.settings);
  }
  const { data: afterArm } = await admin
    .from("beatage_quizzes")
    .select("settings")
    .eq("id", id)
    .maybeSingle();
  const raw = afterArm?.settings ?? quizRow.settings;
  const runtimePatch: {
    liveDeferredTrackKey?: string | null;
    liveOpenMode?: "automatic" | "manual";
  } = {};
  if (patch.liveDeferredTrackKey !== undefined) {
    runtimePatch.liveDeferredTrackKey = patch.liveDeferredTrackKey;
  }
  if (patch.liveOpenMode) {
    runtimePatch.liveOpenMode = patch.liveOpenMode;
  }
  if (Object.keys(runtimePatch).length > 0) {
    await patchQuizRuntimeSettings(admin, id, raw, runtimePatch);
    revalidatePath(`/q/${code}`);
  }
  return { ok: true };
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

