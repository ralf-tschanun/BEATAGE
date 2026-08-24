import { createAdminClient } from "@/lib/supabase/admin";
import { getOptionalUser } from "@/lib/supabase/auth";
import { DEFAULT_MAX_CURATED_TRACKS } from "@/lib/quiz-plans";
import {
  readQuizSettingsRuntime,
  resolveQuizSettings,
} from "@/lib/quiz-scoring";
import type { BeatageQuizSettings } from "@/lib/quiz-settings";
import { DEFAULT_QUIZ_SETTINGS, scoringLowWins } from "@/lib/quiz-settings";
import {
  backfillMissingReleaseYearsForQuiz,
  getQuizCuratedTrackLimit,
} from "@/lib/quiz-tracks";

export type CuratedTrackRow = {
  id: string;
  sort_order: number;
  track_name: string;
  artist_name: string | null;
  /** Never exposed before reveal — use has_release_year for host status. */
  release_year: number | null;
  original_release_year: number | null;
  /** True when a release year is stored (host playlist status only). */
  has_release_year: boolean;
  album_art_url: string | null;
  spotify_track_id: string | null;
};

export type RoundRow = {
  id: string;
  round_number: number;
  status: string;
  track_name: string | null;
  artist_name: string | null;
  /** Only populated after the round is revealed. */
  correct_release_year: number | null;
  original_release_year: number | null;
  /** True when the round has a stored answer year (safe to show before reveal). */
  has_correct_year: boolean;
  album_art_url: string | null;
  preview_url: string | null;
  spotify_track_id: string | null;
  /** Set after reveal when Chart #1 scoring is on. Null while the round is live. */
  chart_was_number_one: boolean | null;
};

export type GuessRow = {
  user_id: string;
  display_name: string;
  /**
   * Hidden while the round is active (host must not see answers early).
   * Populated after reveal for the results list.
   */
  guessed_year: number | null;
  /** Chart #1 yes/no guess — null when not answered. Hidden while round is active. */
  guessed_was_number_one: boolean | null;
  points_total: number;
  /** ISO timestamp — newest first in host / results lists. */
  submitted_at: string;
};

export type LeaderboardRow = {
  user_id: string;
  display_name: string;
  total_points: number;
  /** Points earned in the most recent revealed round (0 if none). */
  last_round_points: number;
};

export type PastRoundRow = RoundRow & {
  /** Caller's points for this round (null if they did not guess). */
  my_points: number | null;
  /** Full guess list when showResultDetails is on. */
  guesses: GuessRow[];
};

function emptyPlayState(joinCode: string) {
  return {
    joinCode,
    currentRoundNumber: 0,
    tracks: [] as CuratedTrackRow[],
    activeRound: null as RoundRow | null,
    resultRound: null as RoundRow | null,
    pastRounds: [] as PastRoundRow[],
    roundGuesses: [] as GuessRow[],
    myGuessYear: null as number | null,
    myGuessWasNumberOne: null as boolean | null,
    leaderboard: [] as LeaderboardRow[],
    memberCount: 0,
    quizStatus: "open",
    maxCuratedTracks: DEFAULT_MAX_CURATED_TRACKS as number | null,
    settings: { ...DEFAULT_QUIZ_SETTINGS } as BeatageQuizSettings,
    autoInterrupted: false,
  };
}

/**
 * Load host/play UI state.
 * Uses the service-role client after a membership check — same pattern as delete/leave.
 * User-scoped selects on beatage_curated_tracks often return [] under RLS even for hosts
 * when play policies/RPCs from 003 are not fully applied on the remote DB.
 */
export async function getQuizPlayState(
  quizId: string,
  joinCode: string,
  options?: { backfillReleaseYears?: boolean },
) {
  const { user } = await getOptionalUser();
  if (!user) {
    return emptyPlayState(joinCode);
  }

  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("beatage_quiz_members")
    .select("user_id, role")
    .eq("quiz_id", quizId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return emptyPlayState(joinCode);
  }

  const [
    { data: quizMeta },
    { data: tracks },
    { data: activeRound },
    { data: revealedRoundsRaw },
    { data: members },
  ] = await Promise.all([
    admin
      .from("beatage_quizzes")
      .select("current_round_number, status, settings")
      .eq("id", quizId)
      .maybeSingle(),
    admin
      .from("beatage_curated_tracks")
      .select(
        "id, sort_order, track_name, artist_name, release_year, original_release_year, album_art_url, spotify_track_id",
      )
      .eq("quiz_id", quizId)
      .order("sort_order", { ascending: true }),
    admin
      .from("beatage_rounds")
      .select(
        "id, round_number, status, track_name, artist_name, correct_release_year, original_release_year, album_art_url, preview_url, spotify_track_id, chart_was_number_one",
      )
      .eq("quiz_id", quizId)
      .eq("status", "active")
      .maybeSingle(),
    admin
      .from("beatage_rounds")
      .select(
        "id, round_number, status, track_name, artist_name, correct_release_year, original_release_year, album_art_url, preview_url, spotify_track_id, chart_was_number_one",
      )
      .eq("quiz_id", quizId)
      .eq("status", "revealed")
      .order("round_number", { ascending: false })
      .limit(30),
    admin
      .from("beatage_quiz_members")
      .select("user_id, display_name")
      .eq("quiz_id", quizId),
  ]);

  const settings = resolveQuizSettings(
    (quizMeta as { settings?: unknown } | null)?.settings,
  );
  const runtime = readQuizSettingsRuntime(
    (quizMeta as { settings?: unknown } | null)?.settings,
  );
  const isHostMember = (membership as { role?: string }).role === "host";
  const hideCorrectForViewer = !settings.showCorrectAnswer && !isHostMember;

  const currentRoundNumber =
    (quizMeta as { current_round_number?: number } | null)?.current_round_number ?? 0;
  const quizStatus =
    typeof (quizMeta as { status?: string } | null)?.status === "string"
      ? (quizMeta as { status: string }).status
      : "open";

  // Host: backfill missing release years (answers stay server-side until reveal).
  let curatedTracksRaw = (tracks ?? []) as Array<{
    id: string;
    sort_order: number;
    track_name: string;
    artist_name: string | null;
    release_year: number | null;
    original_release_year: number | null;
    album_art_url: string | null;
    spotify_track_id: string | null;
  }>;
  const isHost = (membership as { role?: string }).role === "host";
  const shouldBackfill = options?.backfillReleaseYears !== false;
  if (
    shouldBackfill &&
    isHost &&
    curatedTracksRaw.some((track) => track.release_year == null)
  ) {
    const filled = await backfillMissingReleaseYearsForQuiz(quizId, 8);
    if (filled > 0) {
      const { data: refreshed } = await admin
        .from("beatage_curated_tracks")
        .select(
          "id, sort_order, track_name, artist_name, release_year, original_release_year, album_art_url, spotify_track_id",
        )
        .eq("quiz_id", quizId)
        .order("sort_order", { ascending: true });
      curatedTracksRaw = (refreshed ?? []) as typeof curatedTracksRaw;
    }
  }

  // Never send answer years to the client before reveal (host can play fairly).
  const curatedTracks: CuratedTrackRow[] = curatedTracksRaw.map((track) => ({
    ...track,
    has_release_year: track.release_year != null,
    release_year: null,
    original_release_year: null,
  }));

  const activeRoundPublic: RoundRow | null = activeRound
    ? {
        ...(activeRound as RoundRow),
        has_correct_year:
          (activeRound as RoundRow).correct_release_year != null,
        correct_release_year: null,
        original_release_year: null,
        chart_was_number_one: null,
      }
    : null;

  const revealedList = (revealedRoundsRaw ?? []) as RoundRow[];
  const resultRoundPublic: RoundRow | null = revealedList[0]
    ? {
        ...revealedList[0],
        has_correct_year: revealedList[0].correct_release_year != null,
        correct_release_year: hideCorrectForViewer
          ? null
          : revealedList[0].correct_release_year,
        original_release_year: hideCorrectForViewer
          ? null
          : revealedList[0].original_release_year,
        chart_was_number_one:
          typeof revealedList[0].chart_was_number_one === "boolean"
            ? revealedList[0].chart_was_number_one
            : null,
      }
    : null;

  let maxCuratedTracks: number | null = DEFAULT_MAX_CURATED_TRACKS;
  try {
    maxCuratedTracks = await getQuizCuratedTrackLimit(quizId);
  } catch {
    maxCuratedTracks = DEFAULT_MAX_CURATED_TRACKS;
  }

  let myGuessYear: number | null = null;
  let myGuessWasNumberOne: boolean | null = null;
  if (activeRoundPublic) {
    const { data: guess } = await admin
      .from("beatage_guesses")
      .select("guessed_year, guessed_was_number_one")
      .eq("round_id", activeRoundPublic.id)
      .eq("user_id", user.id)
      .maybeSingle();
    myGuessYear = (guess as { guessed_year?: number } | null)?.guessed_year ?? null;
    const chartGuess = (guess as { guessed_was_number_one?: boolean | null } | null)
      ?.guessed_was_number_one;
    myGuessWasNumberOne =
      typeof chartGuess === "boolean" ? chartGuess : null;
  }

  const nameByUser = new Map(
    ((members ?? []) as Array<{ user_id: string; display_name: string }>).map(
      (m) => [m.user_id, m.display_name] as const,
    ),
  );

  let roundGuesses: GuessRow[] = [];
  const resultRound = resultRoundPublic;
  const guessesRound = activeRoundPublic ?? resultRound;
  if (guessesRound) {
    const { data: guesses } = await admin
      .from("beatage_guesses")
      .select("user_id, guessed_year, guessed_was_number_one, points, points_total, submitted_at")
      .eq("round_id", guessesRound.id)
      .order("submitted_at", { ascending: false });

    // While a round is open, never send other players' years to the client
    // (host list only shows submitted / not submitted).
    const hideGuessYears = Boolean(activeRoundPublic);

    roundGuesses = ((guesses ?? []) as Array<{
      user_id: string;
      guessed_year: number | null;
      guessed_was_number_one: boolean | null;
      points: number | null;
      points_total: number | null;
      submitted_at: string | null;
    }>).map((g) => ({
      user_id: g.user_id,
      display_name: nameByUser.get(g.user_id) ?? "Player",
      guessed_year: hideGuessYears ? null : g.guessed_year,
      guessed_was_number_one: hideGuessYears ? null : g.guessed_was_number_one,
      points_total: g.points_total ?? g.points ?? 0,
      submitted_at: g.submitted_at ?? "",
    }));

    if (!hideGuessYears) {
      const lowWins = scoringLowWins(settings);
      roundGuesses.sort((a, b) =>
        lowWins
          ? a.points_total - b.points_total || a.display_name.localeCompare(b.display_name)
          : b.points_total - a.points_total || a.display_name.localeCompare(b.display_name),
      );
    }
  }

  const revealedRoundIds = revealedList.map((r) => r.id);
  const pastGuessesByRound = new Map<string, GuessRow[]>();
  const myPointsByRound = new Map<string, number>();

  if (revealedRoundIds.length > 0) {
    const { data: pastGuesses } = await admin
      .from("beatage_guesses")
      .select(
        "round_id, user_id, guessed_year, guessed_was_number_one, points, points_total, submitted_at",
      )
      .in("round_id", revealedRoundIds)
      .order("submitted_at", { ascending: false });

    for (const g of (pastGuesses ?? []) as Array<{
      round_id: string;
      user_id: string;
      guessed_year: number | null;
      guessed_was_number_one: boolean | null;
      points: number | null;
      points_total: number | null;
      submitted_at: string | null;
    }>) {
      const pts = g.points_total ?? g.points ?? 0;
      if (g.user_id === user.id) {
        myPointsByRound.set(g.round_id, pts);
      }
      if (!settings.showResultDetails) continue;
      if (
        !isHostMember &&
        !settings.showOthersInPastResults &&
        g.user_id !== user.id
      ) {
        continue;
      }
      const list = pastGuessesByRound.get(g.round_id) ?? [];
      list.push({
        user_id: g.user_id,
        display_name: nameByUser.get(g.user_id) ?? "Player",
        guessed_year: g.guessed_year,
        guessed_was_number_one: g.guessed_was_number_one,
        points_total: pts,
        submitted_at: g.submitted_at ?? "",
      });
      pastGuessesByRound.set(g.round_id, list);
    }

    if (settings.showResultDetails) {
      const lowWins = scoringLowWins(settings);
      for (const [roundId, list] of pastGuessesByRound) {
        list.sort((a, b) =>
          lowWins
            ? a.points_total - b.points_total || a.display_name.localeCompare(b.display_name)
            : b.points_total - a.points_total || a.display_name.localeCompare(b.display_name),
        );
        pastGuessesByRound.set(roundId, list);
      }
    }
  }

  const pastRounds: PastRoundRow[] = revealedList.map((round) => ({
    ...round,
    has_correct_year: round.correct_release_year != null,
    correct_release_year:
      hideCorrectForViewer || !settings.showResultDetails
        ? null
        : round.correct_release_year,
    original_release_year:
      hideCorrectForViewer || !settings.showResultDetails
        ? null
        : round.original_release_year,
    chart_was_number_one:
      typeof round.chart_was_number_one === "boolean"
        ? round.chart_was_number_one
        : null,
    my_points: myPointsByRound.has(round.id)
      ? (myPointsByRound.get(round.id) as number)
      : null,
    guesses: settings.showResultDetails
      ? (pastGuessesByRound.get(round.id) ?? [])
      : [],
  }));

  let leaderboard: LeaderboardRow[] = [];
  const latestRevealedId = revealedList[0]?.id ?? null;

  if (revealedRoundIds.length > 0) {
    const { data: allGuesses } = await admin
      .from("beatage_guesses")
      .select("user_id, round_id, points, points_total")
      .in("round_id", revealedRoundIds);

    const totals = new Map<string, number>();
    const lastRoundPts = new Map<string, number>();
    for (const g of (allGuesses ?? []) as Array<{
      user_id: string;
      round_id: string;
      points: number | null;
      points_total: number | null;
    }>) {
      const pts = g.points_total ?? g.points ?? 0;
      totals.set(g.user_id, (totals.get(g.user_id) ?? 0) + pts);
      if (latestRevealedId && g.round_id === latestRevealedId) {
        lastRoundPts.set(g.user_id, pts);
      }
    }

    leaderboard = [...totals.entries()]
      .map(([userId, total_points]) => ({
        user_id: userId,
        display_name: nameByUser.get(userId) ?? "Player",
        total_points,
        last_round_points: lastRoundPts.get(userId) ?? 0,
      }))
      .sort((a, b) => {
        const byPoints = scoringLowWins(settings)
          ? a.total_points - b.total_points
          : b.total_points - a.total_points;
        return byPoints || a.display_name.localeCompare(b.display_name);
      });
  }

  return {
    joinCode,
    currentRoundNumber,
    tracks: curatedTracks,
    activeRound: activeRoundPublic,
    resultRound,
    pastRounds,
    roundGuesses,
    myGuessYear,
    myGuessWasNumberOne,
    leaderboard,
    memberCount: ((members ?? []) as Array<{ user_id: string }>).length,
    quizStatus,
    maxCuratedTracks,
    settings,
    autoInterrupted: Boolean(runtime.autoInterrupted),
  };
}
