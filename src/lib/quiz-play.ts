import { createAdminClient } from "@/lib/supabase/admin";
import { songWasSinglesNumberOne } from "@/lib/charts/was-number-one";
import {
  closerWinsDynamicNoGuessPenalty,
  closerWinsNoGuessYearPenalty,
  correctYearForScoring,
  submittedCloserWinsDistances,
  mergeQuizSettingsForStorage,
  readQuizSettingsRuntime,
  resolveQuizSettings,
  scoreYearGuess,
} from "@/lib/quiz-scoring";
import {
  nextQuizLeaderboardRevealStep,
  isQuizLeaderboardRevealComplete,
  isPreRoundNumber,
  presentsLeaderboardAtEnd,
  primaryYearScoringMode,
} from "@/lib/quiz-settings";
import {
  countQuizPlanConsumedRounds,
  getQuizCuratedTrackLimit,
} from "@/lib/quiz-tracks";

async function assertQuizHost(quizId: string, userId: string) {
  const admin = createAdminClient();
  const { data: quiz, error } = await admin
    .from("beatage_quizzes")
    .select("host_user_id")
    .eq("id", quizId)
    .maybeSingle();

  if (error || !quiz) {
    throw new Error("QUIZ_NOT_FOUND");
  }
  if (quiz.host_user_id !== userId) {
    throw new Error("NOT_HOST");
  }
}

async function assertQuizMember(quizId: string, userId: string) {
  const admin = createAdminClient();
  const { data: member, error } = await admin
    .from("beatage_quiz_members")
    .select("id")
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !member) {
    throw new Error("NOT_MEMBER");
  }
}

/**
 * Start next round using service role.
 * Remote DBs often lack start_beatage_round until migration 003 is applied.
 */
export async function startRoundForHost(
  quizId: string,
  userId: string,
  curatedTrackId?: string | null,
): Promise<{ error?: string }> {
  try {
    await assertQuizHost(quizId, userId);
    const admin = createAdminClient();

    const { data: active } = await admin
      .from("beatage_rounds")
      .select("id")
      .eq("quiz_id", quizId)
      .eq("status", "active")
      .maybeSingle();

    if (active) {
      return { error: "ROUND_ALREADY_ACTIVE" };
    }

    const { data: quiz, error: quizError } = await admin
      .from("beatage_quizzes")
      .select("current_round_number, status, settings, chart_countries, source")
      .eq("id", quizId)
      .maybeSingle();

    if (quizError || !quiz) {
      return { error: "QUIZ_NOT_FOUND" };
    }

    if (quiz.status === "finished" || quiz.status === "expired") {
      return { error: "QUIZ_FINISHED" };
    }
    if (quiz.status === "payment_pending") {
      return { error: "QUIZ_NOT_JOINABLE" };
    }

    const settings = resolveQuizSettings(quiz.settings);
    const runtime = readQuizSettingsRuntime(quiz.settings);
    const chartCountries =
      settings.chartCountries.length > 0
        ? settings.chartCountries
        : ((quiz.chart_countries as string[] | null) ?? ["DE"]);

    const currentRoundNumber =
      typeof quiz.current_round_number === "number" ? quiz.current_round_number : 0;

    const source =
      typeof quiz.source === "string" ? quiz.source : settings.source;
    const isLive = source === "spotify_live" || source === "lastfm_live";
    const isPreRound = isLive && runtime.quizStarted === false;

    // Plan / unlock round cap — official rounds only (pre-rounds / skips do not
    // consume the cap). Count from the rounds table so a stale
    // current_round_number (older pre-round increments) cannot block play.
    const consumedOfficialRounds = await countQuizPlanConsumedRounds(
      quizId,
      runtime,
    );
    const roundLimit = await getQuizCuratedTrackLimit(quizId);
    if (
      !isPreRound &&
      roundLimit != null &&
      consumedOfficialRounds >= roundLimit
    ) {
      return { error: `ROUND_LIMIT:${roundLimit}` };
    }

    let track: {
      spotify_track_id: string | null;
      track_name: string;
      artist_name: string | null;
      album_art_url: string | null;
      preview_url: string | null;
      release_year: number | null;
      original_release_year: number | null;
    } | null = null;

    if (curatedTrackId) {
      const { data, error } = await admin
        .from("beatage_curated_tracks")
        .select(
          "spotify_track_id, track_name, artist_name, album_art_url, preview_url, release_year, original_release_year",
        )
        .eq("id", curatedTrackId)
        .eq("quiz_id", quizId)
        .maybeSingle();
      if (error || !data) {
        return { error: "TRACK_NOT_FOUND" };
      }
      track = data;
    } else {
      const { data, error } = await admin
        .from("beatage_curated_tracks")
        .select(
          "spotify_track_id, track_name, artist_name, album_art_url, preview_url, release_year, original_release_year",
        )
        .eq("quiz_id", quizId)
        .order("sort_order", { ascending: true })
        .range(currentRoundNumber, currentRoundNumber)
        .maybeSingle();
      if (error || !data) {
        return { error: "NO_TRACK_AVAILABLE" };
      }
      track = data;
    }

    // Always allocate the next unique round_number (pre + official share the sequence).
    const { data: maxRoundRow } = await admin
      .from("beatage_rounds")
      .select("round_number")
      .eq("quiz_id", quizId)
      .order("round_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const maxRoundNumber =
      typeof maxRoundRow?.round_number === "number" ? maxRoundRow.round_number : 0;
    const roundNumber = maxRoundNumber + 1;
    const now = new Date().toISOString();

    const needsChartFlag = settings.scoringModes.includes("chart_was_one");
    const chartWasNumberOne = needsChartFlag
      ? await songWasSinglesNumberOne({
          supabase: admin,
          title: track.track_name,
          artist: track.artist_name,
          countryCodes: chartCountries,
        })
      : false;

    const { error: insertError } = await admin.from("beatage_rounds").insert({
      quiz_id: quizId,
      round_number: roundNumber,
      status: "active",
      spotify_track_id: track.spotify_track_id,
      track_name: track.track_name,
      artist_name: track.artist_name,
      album_art_url: track.album_art_url,
      preview_url: track.preview_url,
      correct_release_year: track.release_year,
      original_release_year: track.original_release_year ?? track.release_year,
      chart_was_number_one: chartWasNumberOne,
      started_at: now,
      guess_opens_at: now,
      host_confirmed_at: now,
    });

    if (insertError) {
      return { error: insertError.message };
    }

    // Official rounds bump current_round_number; pre-rounds leave the official counter alone.
    // Use consumed+1 so a previously inflated counter self-heals.
    const { error: updateError } = await admin
      .from("beatage_quizzes")
      .update({
        status: "playing",
        ...(isPreRound
          ? {}
          : { current_round_number: consumedOfficialRounds + 1 }),
        last_activity_at: now,
      })
      .eq("id", quizId);

    if (updateError) {
      return { error: updateError.message };
    }

    return {};
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start round.";
    return { error: message };
  }
}

/** Host ends pre-round mode: next song opens Round 1, or the open pre-round becomes Round 1. */
export async function startOfficialQuizForHost(
  quizId: string,
  userId: string,
  opts?: {
    includeCurrentSong?: boolean;
    /** Last.fm skip-lock so the current track does not become Round 1. */
    deferredTrackKey?: string | null;
  },
): Promise<{ error?: string; closedRound?: boolean; promotedRound?: boolean }> {
  try {
    await assertQuizHost(quizId, userId);
    const admin = createAdminClient();

    const { data: quiz, error: quizError } = await admin
      .from("beatage_quizzes")
      .select("status, settings, source")
      .eq("id", quizId)
      .maybeSingle();

    if (quizError || !quiz) {
      return { error: "QUIZ_NOT_FOUND" };
    }
    if (quiz.status === "finished" || quiz.status === "expired") {
      return { error: "QUIZ_FINISHED" };
    }

    const source =
      typeof quiz.source === "string" ? quiz.source : "curated";
    if (source !== "spotify_live" && source !== "lastfm_live") {
      return { error: "NOT_LIVE_QUIZ" };
    }

    const settings = resolveQuizSettings(quiz.settings);
    const runtime = readQuizSettingsRuntime(quiz.settings);
    if (runtime.quizStarted !== false) {
      return {};
    }

    const includeCurrentSong = Boolean(opts?.includeCurrentSong);

    let closedRound = false;
    let promotedRound = false;
    const { data: active } = await admin
      .from("beatage_rounds")
      .select("id, round_number")
      .eq("quiz_id", quizId)
      .eq("status", "active")
      .maybeSingle();

    if (includeCurrentSong && active?.id) {
      promotedRound = true;
    } else if (!includeCurrentSong && active?.id) {
      const closed = await closeRoundForHost(active.id, userId);
      if (closed.error) {
        return { error: closed.error };
      }
      closedRound = true;
    }

    const { data: maxRoundRow } = await admin
      .from("beatage_rounds")
      .select("round_number")
      .eq("quiz_id", quizId)
      .order("round_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const maxRoundNumber =
      typeof maxRoundRow?.round_number === "number"
        ? maxRoundRow.round_number
        : 0;
    const activeRoundNumber =
      typeof active?.round_number === "number" ? active.round_number : 0;
    // Keep the open pre-round out of the cutoff so it labels and scores as Round 1.
    const preRoundCutoff = promotedRound
      ? Math.max(0, activeRoundNumber - 1)
      : maxRoundNumber;

    const deferredTrackKey = includeCurrentSong
      ? null
      : typeof opts?.deferredTrackKey === "string" &&
          opts.deferredTrackKey.trim()
        ? opts.deferredTrackKey.trim()
        : runtime.liveDeferredTrackKey;

    const { error: updateError } = await admin
      .from("beatage_quizzes")
      .update({
        settings: mergeQuizSettingsForStorage(settings, {
          ...runtime,
          quizStarted: true,
          preRoundCutoff,
          autoEmptyStreak: 0,
          autoInterrupted: false,
          liveDeferredTrackKey: deferredTrackKey ?? null,
        }),
        // Warm-up consumed 0 official rounds; this song becomes Round 1.
        ...(promotedRound ? { current_round_number: 1 } : {}),
        last_activity_at: new Date().toISOString(),
      })
      .eq("id", quizId);

    if (updateError) {
      return { error: updateError.message };
    }

    return { closedRound, promotedRound };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start quiz.";
    return { error: message };
  }
}

export async function submitGuessForMember(
  roundId: string,
  userId: string,
  guessedYear: number,
  guessedWasNumberOne: boolean | null = null,
): Promise<{ error?: string }> {
  try {
    if (
      !Number.isFinite(guessedYear) ||
      guessedYear < 1900 ||
      guessedYear > new Date().getFullYear()
    ) {
      return { error: "INVALID_YEAR" };
    }

    const admin = createAdminClient();
    const { data: round, error: roundError } = await admin
      .from("beatage_rounds")
      .select("id, quiz_id, status")
      .eq("id", roundId)
      .maybeSingle();

    if (roundError || !round) {
      return { error: "ROUND_NOT_FOUND" };
    }

    await assertQuizMember(round.quiz_id, userId);

    if (round.status !== "active") {
      return { error: "ROUND_NOT_ACTIVE" };
    }

    const { error } = await admin.from("beatage_guesses").upsert(
      {
        quiz_id: round.quiz_id,
        round_id: roundId,
        user_id: userId,
        guessed_year: guessedYear,
        guessed_was_number_one: guessedWasNumberOne,
        submitted_at: new Date().toISOString(),
      },
      { onConflict: "round_id,user_id" },
    );

    if (error) {
      return { error: error.message };
    }

    return {};
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit guess.";
    return { error: message };
  }
}

export async function closeRoundForHost(
  roundId: string,
  userId: string,
): Promise<{ error?: string }> {
  try {
    const admin = createAdminClient();
    const { data: round, error: roundError } = await admin
      .from("beatage_rounds")
      .select(
        "id, quiz_id, status, correct_release_year, original_release_year, chart_was_number_one, track_name, artist_name",
      )
      .eq("id", roundId)
      .maybeSingle();

    if (roundError || !round) {
      return { error: "ROUND_NOT_FOUND" };
    }

    await assertQuizHost(round.quiz_id, userId);

    if (round.status !== "active") {
      return { error: "ROUND_NOT_ACTIVE" };
    }

    const { data: quizRow } = await admin
      .from("beatage_quizzes")
      .select("settings, chart_countries")
      .eq("id", round.quiz_id)
      .maybeSingle();
    const settings = resolveQuizSettings(quizRow?.settings);

    let wasNumberOne = Boolean(round.chart_was_number_one);
    if (
      settings.scoringModes.includes("chart_was_one") &&
      round.chart_was_number_one == null &&
      round.track_name
    ) {
      const countries =
        settings.chartCountries.length > 0
          ? settings.chartCountries
          : ((quizRow?.chart_countries as string[] | null) ?? ["DE"]);
      wasNumberOne = await songWasSinglesNumberOne({
        supabase: admin,
        title: round.track_name as string,
        artist: (round.artist_name as string | null) ?? null,
        countryCodes: countries,
      });
      await admin
        .from("beatage_rounds")
        .update({ chart_was_number_one: wasNumberOne })
        .eq("id", roundId);
    }

    const correct = correctYearForScoring({
      releaseYear: round.correct_release_year as number | null,
      originalReleaseYear: round.original_release_year as number | null,
      answerYearMode: settings.answerYearMode,
    });

    const { data: guesses } = await admin
      .from("beatage_guesses")
      .select("id, user_id, guessed_year, guessed_was_number_one")
      .eq("round_id", roundId);

    const guessRows = (guesses ?? []) as Array<{
      id: string;
      user_id: string;
      guessed_year: number | null;
      guessed_was_number_one: boolean | null;
    }>;

    // Freeze skip penalty from submitted years only, before skip rows exist.
    // All skippers share this one value — do not recompute after inserts.
    const submittedYearGuesses = guessRows.filter(
      (g) => g.guessed_year != null,
    );
    const yearMode = primaryYearScoringMode(settings.scoringModes);
    const submittedDistances =
      correct != null
        ? submittedCloserWinsDistances(
            submittedYearGuesses.map((g) => g.guessed_year),
            correct,
          )
        : [];
    const noGuessYearPenalty =
      yearMode === "year_distance"
        ? closerWinsNoGuessYearPenalty(submittedDistances)
        : yearMode === "year_distance_dynamic"
          ? closerWinsDynamicNoGuessPenalty(submittedDistances)
          : 0;

    const { data: members } = await admin
      .from("beatage_quiz_members")
      .select("user_id, role")
      .eq("quiz_id", round.quiz_id);

    const submittedYearUserIds = new Set(
      submittedYearGuesses.map((g) => g.user_id),
    );
    const skipUserIds = (
      (members ?? []) as Array<{ user_id: string; role: string | null }>
    )
      .filter((m) => {
        if (submittedYearUserIds.has(m.user_id)) return false;
        if (m.role === "host" && !settings.hostParticipates) return false;
        return true;
      })
      .map((m) => m.user_id);

    const now = new Date().toISOString();

    if (skipUserIds.length > 0) {
      const skipRows = skipUserIds.map((userId) => ({
        quiz_id: round.quiz_id,
        round_id: roundId,
        user_id: userId,
        guessed_year: null,
        guessed_was_number_one: null,
        submitted_at: now,
      }));
      const { error: skipInsertError } = await admin
        .from("beatage_guesses")
        .upsert(skipRows, { onConflict: "round_id,user_id" });
      if (skipInsertError) {
        return { error: skipInsertError.message };
      }
    }

    const { data: allGuesses } = await admin
      .from("beatage_guesses")
      .select("id, guessed_year, guessed_was_number_one")
      .eq("round_id", roundId);

    for (const guess of (allGuesses ?? []) as Array<{
      id: string;
      guessed_year: number | null;
      guessed_was_number_one: boolean | null;
    }>) {
      const scored = scoreYearGuess({
        guessedYear: guess.guessed_year,
        correctYear: correct,
        settings,
        wasNumberOne,
        guessedWasNumberOne: guess.guessed_was_number_one,
        noGuessYearPenalty,
      });
      const { error: scoreError } = await admin
        .from("beatage_guesses")
        .update({
          points: scored.points,
          points_total: scored.points,
          points_breakdown: scored.breakdown,
        })
        .eq("id", guess.id);
      if (scoreError) {
        return { error: scoreError.message };
      }
    }

    const { error: closeError } = await admin
      .from("beatage_rounds")
      .update({
        status: "revealed",
        revealed_at: now,
        guess_closes_at: now,
      })
      .eq("id", roundId);

    if (closeError) {
      return { error: closeError.message };
    }

    await admin
      .from("beatage_quizzes")
      .update({ last_activity_at: now })
      .eq("id", round.quiz_id);

    return {};
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to close round.";
    return { error: message };
  }
}

/**
 * Mark a quiz as finished. Frees the active plan slot (finished does not count).
 * Host may finish after the last track or end early — not while a round is active.
 */
export async function finishQuizForHost(
  quizId: string,
  userId: string,
): Promise<{ error?: string }> {
  try {
    await assertQuizHost(quizId, userId);
    const admin = createAdminClient();

    const { data: quiz, error: quizError } = await admin
      .from("beatage_quizzes")
      .select("id, status")
      .eq("id", quizId)
      .maybeSingle();

    if (quizError || !quiz) {
      return { error: "QUIZ_NOT_FOUND" };
    }

    if (quiz.status === "finished") {
      return {};
    }
    if (quiz.status === "expired") {
      return { error: "QUIZ_EXPIRED" };
    }
    if (quiz.status === "payment_pending") {
      return { error: "QUIZ_NOT_JOINABLE" };
    }
    if (quiz.status !== "open" && quiz.status !== "playing" && quiz.status !== "draft") {
      return { error: "QUIZ_NOT_JOINABLE" };
    }

    const { data: active } = await admin
      .from("beatage_rounds")
      .select("id")
      .eq("quiz_id", quizId)
      .eq("status", "active")
      .maybeSingle();

    // Finish must work at plan limits when a round is still open — close it first.
    if (active) {
      const closed = await closeRoundForHost(active.id, userId);
      if (closed.error) {
        return { error: closed.error };
      }
    }

    const now = new Date().toISOString();
    const { data: quizSettingsRow } = await admin
      .from("beatage_quizzes")
      .select("settings")
      .eq("id", quizId)
      .maybeSingle();
    const settings = resolveQuizSettings(
      (quizSettingsRow as { settings?: unknown } | null)?.settings,
    );
    const runtime = readQuizSettingsRuntime(
      (quizSettingsRow as { settings?: unknown } | null)?.settings,
    );
    const nextSettings = mergeQuizSettingsForStorage(settings, {
      ...runtime,
      liveSyncEnabled: false,
      ...(presentsLeaderboardAtEnd(settings) ? { leaderboardRevealStep: 0 } : {}),
    });

    const { error: updateError } = await admin
      .from("beatage_quizzes")
      .update({
        status: "finished",
        last_activity_at: now,
        ...(nextSettings ? { settings: nextSettings } : {}),
      })
      .eq("id", quizId);

    if (updateError) {
      return { error: updateError.message };
    }

    return {};
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to finish quiz.";
    return { error: message };
  }
}

/**
 * Advance the end-of-quiz leaderboard presentation by one step (host only).
 * immediate: first click shows the full board; last_to_first: one place per click.
 */
export async function advanceLeaderboardRevealForHost(
  quizId: string,
  userId: string,
): Promise<{ error?: string; step?: number; complete?: boolean }> {
  try {
    await assertQuizHost(quizId, userId);
    const admin = createAdminClient();

    const { data: quiz, error: quizError } = await admin
      .from("beatage_quizzes")
      .select("id, status, settings")
      .eq("id", quizId)
      .maybeSingle();

    if (quizError || !quiz) {
      return { error: "QUIZ_NOT_FOUND" };
    }
    if (quiz.status !== "finished") {
      return { error: "QUIZ_NOT_FINISHED" };
    }

    const settings = resolveQuizSettings(
      (quiz as { settings?: unknown }).settings,
    );
    if (!presentsLeaderboardAtEnd(settings)) {
      return { error: "NO_LEADERBOARD_PRESENTATION" };
    }

    const runtime = readQuizSettingsRuntime(
      (quiz as { settings?: unknown }).settings,
    );
    const currentStep = runtime.leaderboardRevealStep ?? 0;

    // Same population as getQuizPlayState leaderboard (guesses on revealed rounds).
    const { data: revealedRounds } = await admin
      .from("beatage_rounds")
      .select("id")
      .eq("quiz_id", quizId)
      .eq("status", "revealed");
    const revealedIds = (revealedRounds ?? []).map(
      (row) => (row as { id: string }).id,
    );
    let playerCount = 0;
    if (revealedIds.length > 0) {
      const { data: allGuesses } = await admin
        .from("beatage_guesses")
        .select("user_id")
        .in("round_id", revealedIds);
      playerCount = new Set(
        (allGuesses ?? []).map((g) => (g as { user_id: string }).user_id),
      ).size;
    }

    const nextStep = nextQuizLeaderboardRevealStep(
      settings.overallReveal,
      currentStep,
      playerCount,
    );
    if (nextStep == null) {
      return { step: currentStep, complete: true };
    }

    const { error: updateError } = await admin
      .from("beatage_quizzes")
      .update({
        settings: mergeQuizSettingsForStorage(settings, {
          ...runtime,
          leaderboardRevealStep: nextStep,
        }),
        last_activity_at: new Date().toISOString(),
      })
      .eq("id", quizId);

    if (updateError) {
      return { error: updateError.message };
    }

    const complete = isQuizLeaderboardRevealComplete(
      settings.overallReveal,
      nextStep,
      playerCount,
    );

    return { step: nextStep, complete };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to advance leaderboard reveal.";
    return { error: message };
  }
}

/**
 * Host skips the active round: discard guesses, do not score, do not consume an
 * official round slot (current_round_number is rolled back when applicable).
 */
export async function skipRoundForHost(
  roundId: string,
  userId: string,
): Promise<{ error?: string }> {
  try {
    const admin = createAdminClient();
    const { data: round, error: roundError } = await admin
      .from("beatage_rounds")
      .select("id, quiz_id, status, round_number")
      .eq("id", roundId)
      .maybeSingle();

    if (roundError || !round) {
      return { error: "ROUND_NOT_FOUND" };
    }

    await assertQuizHost(round.quiz_id, userId);

    if (round.status !== "active") {
      return { error: "ROUND_NOT_ACTIVE" };
    }

    const { data: quizRow } = await admin
      .from("beatage_quizzes")
      .select("current_round_number, settings")
      .eq("id", round.quiz_id)
      .maybeSingle();

    const runtime = readQuizSettingsRuntime(quizRow?.settings);
    const isPre = isPreRoundNumber(
      round.round_number as number,
      runtime,
    );

    const { error: deleteGuessesError } = await admin
      .from("beatage_guesses")
      .delete()
      .eq("round_id", roundId);
    if (deleteGuessesError) {
      return { error: deleteGuessesError.message };
    }

    const now = new Date().toISOString();
    const { error: skipError } = await admin
      .from("beatage_rounds")
      .update({
        status: "skipped",
        revealed_at: now,
        guess_closes_at: now,
      })
      .eq("id", roundId);

    if (skipError) {
      return { error: skipError.message };
    }

    const currentRoundNumber =
      typeof quizRow?.current_round_number === "number"
        ? quizRow.current_round_number
        : 0;
    const nextCurrentRoundNumber = isPre
      ? currentRoundNumber
      : await countQuizPlanConsumedRounds(round.quiz_id, runtime);

    const { error: quizUpdateError } = await admin
      .from("beatage_quizzes")
      .update({
        current_round_number: nextCurrentRoundNumber,
        last_activity_at: now,
      })
      .eq("id", round.quiz_id);

    if (quizUpdateError) {
      return { error: quizUpdateError.message };
    }

    return {};
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to skip round.";
    return { error: message };
  }
}

/** Host excludes a revealed round from leaderboard scoring (toggle back via include). */
export async function excludeRoundFromScoringForHost(
  roundId: string,
  userId: string,
): Promise<{ error?: string }> {
  try {
    const admin = createAdminClient();
    const { data: round, error: roundError } = await admin
      .from("beatage_rounds")
      .select("id, quiz_id, status")
      .eq("id", roundId)
      .maybeSingle();

    if (roundError || !round) {
      return { error: "ROUND_NOT_FOUND" };
    }

    await assertQuizHost(round.quiz_id, userId);

    if (round.status !== "revealed") {
      return { error: "ROUND_NOT_SCORABLE" };
    }

    const { error } = await admin
      .from("beatage_rounds")
      .update({ status: "excluded" })
      .eq("id", roundId);

    if (error) {
      return { error: error.message };
    }

    await admin
      .from("beatage_quizzes")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", round.quiz_id);

    return {};
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to exclude round.";
    return { error: message };
  }
}

/** Host restores a previously excluded round to scoring. */
export async function includeRoundInScoringForHost(
  roundId: string,
  userId: string,
): Promise<{ error?: string }> {
  try {
    const admin = createAdminClient();
    const { data: round, error: roundError } = await admin
      .from("beatage_rounds")
      .select("id, quiz_id, status")
      .eq("id", roundId)
      .maybeSingle();

    if (roundError || !round) {
      return { error: "ROUND_NOT_FOUND" };
    }

    await assertQuizHost(round.quiz_id, userId);

    if (round.status !== "excluded") {
      return { error: "ROUND_NOT_EXCLUDED" };
    }

    const { error } = await admin
      .from("beatage_rounds")
      .update({ status: "revealed" })
      .eq("id", roundId);

    if (error) {
      return { error: error.message };
    }

    await admin
      .from("beatage_quizzes")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", round.quiz_id);

    return {};
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to include round.";
    return { error: message };
  }
}
