import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLastfmCurrentlyPlaying, lastfmTrackKey } from "@/lib/lastfm";
import { addCuratedTrackToQuiz } from "@/lib/quiz-tracks";
import { closeRoundForHost, startRoundForHost } from "@/lib/quiz-play";
import {
  isRoundAlreadyClosedError,
  resolveActiveRound,
} from "@/lib/quiz-active-round";
import {
  applyEmptyRoundStreak,
  forceAutoInterrupted,
  patchQuizRuntimeSettings,
} from "@/lib/quiz-live-runtime";
import { readQuizSettingsRuntime, resolveQuizSettings } from "@/lib/quiz-scoring";

/** How often the cron loop asks Last.fm while a quiz is armed. */
export const LASTFM_LIVE_CRON_POLL_MS = 7_000;
/** Stay awake inside one Vercel minute tick (needs route maxDuration ≥ 60). */
export const LASTFM_LIVE_CRON_LOOP_MS = 52_000;
/** Disarm server follow if the host never paused/ended. */
export const LASTFM_LIVE_CRON_MAX_MS = 4 * 60 * 60 * 1000;
/** After we have seen playback: nothing on Last.fm this long → pause like interrupt. */
export const LASTFM_LIVE_CRON_SILENCE_MS = 15 * 60 * 1000;

export type LastfmNowPlayingHint =
  | { playing: false }
  | { playing: true; title: string; artist: string; albumArtUrl?: string | null };

export type LastfmLiveSyncResult = {
  ok?: boolean;
  error?: string;
  code?: string;
  skipped?: boolean;
  trackId?: string;
  trackTitle?: string;
  trackArtist?: string;
  closedRound?: boolean;
  startedRound?: boolean;
  nothingPlaying?: boolean;
  interrupted?: boolean;
  emptyStreak?: number;
};

function mapPlayError(message: string): string {
  if (message.includes("NOT_HOST")) return "Only the host can do that.";
  if (message.includes("ROUND_ALREADY_ACTIVE")) return "A round is already active.";
  if (message.includes("QUIZ_FINISHED")) return "This quiz has ended.";
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
  return message;
}

function parseLastfmNowPlayingHint(hint: LastfmNowPlayingHint | undefined):
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

async function loadQuizRow(
  admin: ReturnType<typeof createAdminClient>,
  quizId: string,
) {
  const { data } = await admin
    .from("beatage_quizzes")
    .select("host_user_id, status, settings, source, join_code")
    .eq("id", quizId)
    .maybeSingle();
  return data;
}

async function pauseLastfmLiveForCron(opts: {
  admin: ReturnType<typeof createAdminClient>;
  quizId: string;
  joinCode: string;
  hostUserId: string;
  rawSettings: unknown;
}): Promise<LastfmLiveSyncResult> {
  const { admin, quizId, joinCode, hostUserId, rawSettings } = opts;
  const active = await resolveActiveRound(quizId);
  let closedRound = false;
  if (active?.id) {
    const closed = await closeRoundForHost(active.id, hostUserId);
    if (closed.error && !isRoundAlreadyClosedError(closed.error)) {
      return { error: mapPlayError(closed.error) };
    }
    closedRound = !closed.error;
  }
  await forceAutoInterrupted(admin, quizId, rawSettings);
  revalidatePath(`/q/${joinCode}`);
  return { ok: true, closedRound, interrupted: true, startedRound: false };
}

/**
 * Close / open Last.fm live rounds as the quiz host (no browser session required).
 * Cron applies the 4h cap, silence pause, and skip-lock; host calls skip those caps.
 */
export async function syncLastfmLiveQuiz(opts: {
  quizId: string;
  joinCode: string;
  hostUserId: string;
  source: "host" | "cron";
  forceClose?: boolean;
  openNewRound?: boolean;
  nowPlaying?: LastfmNowPlayingHint;
}): Promise<LastfmLiveSyncResult> {
  const id = opts.quizId.trim();
  const code = opts.joinCode.trim().toUpperCase();
  let openNewRound = opts.openNewRound !== false;
  const admin = createAdminClient();

  const quizRow = await loadQuizRow(admin, id);
  if (!quizRow || quizRow.host_user_id !== opts.hostUserId) {
    return { error: mapPlayError("NOT_HOST") };
  }
  if (quizRow.status === "finished" || quizRow.status === "expired") {
    return { error: mapPlayError("QUIZ_FINISHED") };
  }
  if (quizRow.source !== "lastfm_live") {
    return { error: "This quiz is not in Last.fm live mode." };
  }

  let rawSettings = (quizRow as { settings?: unknown }).settings;
  let runtime = readQuizSettingsRuntime(rawSettings);
  const settings = resolveQuizSettings(rawSettings);

  if (opts.source === "cron") {
    if (
      !runtime.liveSyncEnabled ||
      runtime.autoInterrupted ||
      runtime.liveOpenMode === "manual" ||
      !settings.lastfmUsername
    ) {
      return { ok: true, skipped: true };
    }
    const armedAtMs = runtime.liveSyncArmedAt
      ? Date.parse(runtime.liveSyncArmedAt)
      : NaN;
    if (
      Number.isFinite(armedAtMs) &&
      Date.now() - armedAtMs >= LASTFM_LIVE_CRON_MAX_MS
    ) {
      return pauseLastfmLiveForCron({
        admin,
        quizId: id,
        joinCode: code,
        hostUserId: opts.hostUserId,
        rawSettings,
      });
    }
    // Pre-round warm-up: only the host tab opens rounds (listen debounce / reveal).
    // Cron still closes rounds when the track stops or changes.
    if (runtime.quizStarted === false) {
      openNewRound = false;
    }
  }

  if (runtime.autoInterrupted && openNewRound) {
    return {
      ok: true,
      interrupted: true,
      emptyStreak: runtime.autoEmptyStreak ?? 0,
      startedRound: false,
      closedRound: false,
    };
  }

  const hinted = parseLastfmNowPlayingHint(opts.nowPlaying);
  if (opts.forceClose && !openNewRound && hinted?.playing !== true) {
    const active = await resolveActiveRound(id);
    if (active?.id) {
      const closed = await closeRoundForHost(active.id, opts.hostUserId);
      if (closed.error && !isRoundAlreadyClosedError(closed.error)) {
        return { error: mapPlayError(closed.error) };
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
    if (opts.source === "cron" && runtime.liveSyncHadPlayback) {
      const since = runtime.liveSyncNotPlayingSince
        ? Date.parse(runtime.liveSyncNotPlayingSince)
        : NaN;
      if (!Number.isFinite(since)) {
        rawSettings = await patchQuizRuntimeSettings(admin, id, rawSettings, {
          liveSyncNotPlayingSince: new Date().toISOString(),
        });
      } else if (Date.now() - since >= LASTFM_LIVE_CRON_SILENCE_MS) {
        return pauseLastfmLiveForCron({
          admin,
          quizId: id,
          joinCode: code,
          hostUserId: opts.hostUserId,
          rawSettings,
        });
      }
    }

    if (opts.forceClose) {
      const active = await resolveActiveRound(id);
      if (active?.id) {
        const closed = await closeRoundForHost(active.id, opts.hostUserId);
        if (closed.error && !isRoundAlreadyClosedError(closed.error)) {
          return { error: mapPlayError(closed.error) };
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

  if (opts.source === "cron") {
    rawSettings = await patchQuizRuntimeSettings(admin, id, rawSettings, {
      liveSyncHadPlayback: true,
      liveSyncNotPlayingSince: null,
    });
    runtime = readQuizSettingsRuntime(rawSettings);
  }

  if (
    runtime.liveDeferredTrackKey &&
    runtime.liveDeferredTrackKey === track.trackKey &&
    openNewRound &&
    !opts.forceClose
  ) {
    return {
      ok: true,
      trackTitle: track.title,
      trackArtist: track.artist,
      startedRound: false,
      closedRound: false,
    };
  }

  const active = await resolveActiveRound(id);

  let closedRound = false;
  let interrupted = Boolean(runtime.autoInterrupted);
  let emptyStreak = runtime.autoEmptyStreak ?? 0;
  if (active?.id) {
    const activeKey = lastfmTrackKey(
      String(active.track_name ?? ""),
      String(active.artist_name ?? ""),
    );
    const sameTrack = activeKey === track.trackKey;
    if (!sameTrack || opts.forceClose) {
      const closed = await closeRoundForHost(active.id, opts.hostUserId);
      if (closed.error && !isRoundAlreadyClosedError(closed.error)) {
        return { error: mapPlayError(closed.error) };
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

  if (runtime.liveDeferredTrackKey === track.trackKey) {
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

  if (runtime.liveDeferredTrackKey) {
    rawSettings = await patchQuizRuntimeSettings(admin, id, rawSettings, {
      liveDeferredTrackKey: null,
    });
  }

  const addResult = await addCuratedTrackToQuiz(admin, id, {
    title: track.title,
    artist: track.artist,
    albumArtUrl: track.albumArtUrl ?? undefined,
  });
  if (addResult.error) {
    return { error: mapPlayError(addResult.error) };
  }
  const curatedTrackId = addResult.trackId;
  if (!curatedTrackId) {
    return { error: "Could not save the track to this quiz." };
  }

  const started = await startRoundForHost(id, opts.hostUserId, curatedTrackId);
  if (started.error) {
    if (String(started.error).includes("ROUND_ALREADY_ACTIVE")) {
      revalidatePath(`/q/${code}`);
      return {
        ok: true,
        trackId: curatedTrackId,
        trackTitle: track.title,
        trackArtist: track.artist,
        closedRound,
        startedRound: false,
        interrupted: false,
        emptyStreak,
      };
    }
    return { error: mapPlayError(started.error) };
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

export async function armLastfmLiveSync(
  admin: ReturnType<typeof createAdminClient>,
  quizId: string,
  rawSettings: unknown,
  opts?: { resetTimer?: boolean },
) {
  const runtime = readQuizSettingsRuntime(rawSettings);
  const now = new Date().toISOString();
  const armedAt =
    opts?.resetTimer || !runtime.liveSyncEnabled || !runtime.liveSyncArmedAt
      ? now
      : runtime.liveSyncArmedAt;
  await patchQuizRuntimeSettings(admin, quizId, rawSettings, {
    liveSyncEnabled: true,
    liveSyncArmedAt: armedAt,
    liveSyncNotPlayingSince: opts?.resetTimer ? null : runtime.liveSyncNotPlayingSince,
    liveSyncHadPlayback: opts?.resetTimer ? false : runtime.liveSyncHadPlayback,
  });
}

export async function tickLastfmLiveQuizzes(): Promise<{
  considered: number;
  synced: number;
  skipped: number;
  errors: number;
}> {
  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("beatage_quizzes")
    .select("id, join_code, host_user_id, settings, status")
    .eq("source", "lastfm_live")
    .in("status", ["open", "playing"]);

  if (error || !rows) {
    return { considered: 0, synced: 0, skipped: 0, errors: error ? 1 : 0 };
  }

  let synced = 0;
  let skipped = 0;
  let errors = 0;
  for (const row of rows) {
    const runtime = readQuizSettingsRuntime(row.settings);
    const settings = resolveQuizSettings(row.settings);
    if (
      !runtime.liveSyncEnabled ||
      runtime.autoInterrupted ||
      runtime.liveOpenMode === "manual" ||
      !settings.lastfmUsername
    ) {
      skipped += 1;
      continue;
    }
    const result = await syncLastfmLiveQuiz({
      quizId: row.id,
      joinCode: String(row.join_code ?? ""),
      hostUserId: row.host_user_id,
      source: "cron",
    });
    if (result.error) {
      errors += 1;
      continue;
    }
    if (result.skipped) {
      skipped += 1;
      continue;
    }
    synced += 1;
  }

  return { considered: rows.length, synced, skipped, errors };
}
