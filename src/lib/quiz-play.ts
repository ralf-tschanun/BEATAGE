import { createAdminClient } from "@/lib/supabase/admin";
import { songWasSinglesNumberOne } from "@/lib/charts/was-number-one";
import {
  correctYearForScoring,
  resolveQuizSettings,
  scoreYearGuess,
} from "@/lib/quiz-scoring";

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
      .select("current_round_number, status, settings, chart_countries")
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
    const chartCountries =
      settings.chartCountries.length > 0
        ? settings.chartCountries
        : ((quiz.chart_countries as string[] | null) ?? ["DE"]);

    const currentRoundNumber =
      typeof quiz.current_round_number === "number" ? quiz.current_round_number : 0;

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

    const roundNumber = currentRoundNumber + 1;
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

    const { error: updateError } = await admin
      .from("beatage_quizzes")
      .update({
        status: "playing",
        current_round_number: roundNumber,
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
      .select("id, guessed_year, guessed_was_number_one")
      .eq("round_id", roundId);

    for (const guess of (guesses ?? []) as Array<{
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

    const now = new Date().toISOString();
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

    if (active) {
      return { error: "CLOSE_ROUND_FIRST" };
    }

    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("beatage_quizzes")
      .update({
        status: "finished",
        last_activity_at: now,
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
