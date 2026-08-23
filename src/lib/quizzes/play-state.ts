import { createAdminClient } from "@/lib/supabase/admin";
import { getOptionalUser } from "@/lib/supabase/auth";
import { DEFAULT_MAX_CURATED_TRACKS } from "@/lib/quiz-plans";
import { getQuizCuratedTrackLimit } from "@/lib/quiz-tracks";

export type CuratedTrackRow = {
  id: string;
  sort_order: number;
  track_name: string;
  artist_name: string | null;
  release_year: number | null;
  original_release_year: number | null;
  album_art_url: string | null;
};

export type RoundRow = {
  id: string;
  round_number: number;
  status: string;
  track_name: string | null;
  artist_name: string | null;
  correct_release_year: number | null;
  original_release_year: number | null;
  album_art_url: string | null;
  preview_url: string | null;
};

export type GuessRow = {
  user_id: string;
  display_name: string;
  guessed_year: number | null;
  points_total: number;
};

export type LeaderboardRow = {
  user_id: string;
  display_name: string;
  total_points: number;
};

/**
 * Load host/play UI state.
 * Uses the service-role client after a membership check — same pattern as delete/leave.
 * User-scoped selects on beatage_curated_tracks often return [] under RLS even for hosts
 * when play policies/RPCs from 003 are not fully applied on the remote DB.
 */
export async function getQuizPlayState(quizId: string, joinCode: string) {
  const { user } = await getOptionalUser();
  if (!user) {
    return {
      joinCode,
      currentRoundNumber: 0,
      tracks: [] as CuratedTrackRow[],
      activeRound: null as RoundRow | null,
      resultRound: null as RoundRow | null,
      roundGuesses: [] as GuessRow[],
      myGuessYear: null as number | null,
      leaderboard: [] as LeaderboardRow[],
      memberCount: 0,
      quizStatus: "open",
      maxCuratedTracks: DEFAULT_MAX_CURATED_TRACKS,
    };
  }

  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("beatage_quiz_members")
    .select("user_id, role")
    .eq("quiz_id", quizId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return {
      joinCode,
      currentRoundNumber: 0,
      tracks: [] as CuratedTrackRow[],
      activeRound: null as RoundRow | null,
      resultRound: null as RoundRow | null,
      roundGuesses: [] as GuessRow[],
      myGuessYear: null as number | null,
      leaderboard: [] as LeaderboardRow[],
      memberCount: 0,
      quizStatus: "open",
      maxCuratedTracks: DEFAULT_MAX_CURATED_TRACKS,
    };
  }

  const [
    { data: quizMeta },
    { data: tracks },
    { data: activeRound },
    { data: lastRevealed },
    { data: members },
  ] = await Promise.all([
    admin
      .from("beatage_quizzes")
      .select("current_round_number, status")
      .eq("id", quizId)
      .maybeSingle(),
    admin
      .from("beatage_curated_tracks")
      .select(
        "id, sort_order, track_name, artist_name, release_year, original_release_year, album_art_url",
      )
      .eq("quiz_id", quizId)
      .order("sort_order", { ascending: true }),
    admin
      .from("beatage_rounds")
      .select(
        "id, round_number, status, track_name, artist_name, correct_release_year, original_release_year, album_art_url, preview_url",
      )
      .eq("quiz_id", quizId)
      .eq("status", "active")
      .maybeSingle(),
    admin
      .from("beatage_rounds")
      .select(
        "id, round_number, status, track_name, artist_name, correct_release_year, original_release_year, album_art_url, preview_url",
      )
      .eq("quiz_id", quizId)
      .eq("status", "revealed")
      .order("round_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("beatage_quiz_members")
      .select("user_id, display_name")
      .eq("quiz_id", quizId),
  ]);

  const currentRoundNumber =
    (quizMeta as { current_round_number?: number } | null)?.current_round_number ?? 0;
  const quizStatus =
    typeof (quizMeta as { status?: string } | null)?.status === "string"
      ? (quizMeta as { status: string }).status
      : "open";

  let maxCuratedTracks: number | null = DEFAULT_MAX_CURATED_TRACKS;
  try {
    maxCuratedTracks = await getQuizCuratedTrackLimit(quizId);
  } catch {
    maxCuratedTracks = DEFAULT_MAX_CURATED_TRACKS;
  }

  let myGuessYear: number | null = null;
  if (activeRound) {
    const { data: guess } = await admin
      .from("beatage_guesses")
      .select("guessed_year")
      .eq("round_id", activeRound.id)
      .eq("user_id", user.id)
      .maybeSingle();
    myGuessYear = (guess as { guessed_year?: number } | null)?.guessed_year ?? null;
  }

  let roundGuesses: GuessRow[] = [];
  const resultRound = lastRevealed ?? null;
  const guessesRound = activeRound ?? resultRound;
  if (guessesRound) {
    const { data: guesses } = await admin
      .from("beatage_guesses")
      .select("user_id, guessed_year, points, points_total")
      .eq("round_id", guessesRound.id);

    const nameByUser = new Map(
      ((members ?? []) as Array<{ user_id: string; display_name: string }>).map(
        (m) => [m.user_id, m.display_name] as const,
      ),
    );

    roundGuesses = ((guesses ?? []) as Array<{
      user_id: string;
      guessed_year: number | null;
      points: number | null;
      points_total: number | null;
    }>).map((g) => ({
      user_id: g.user_id,
      display_name: nameByUser.get(g.user_id) ?? "Player",
      guessed_year: g.guessed_year,
      points_total: g.points_total ?? g.points ?? 0,
    }));
  }

  const { data: allRounds } = await admin
    .from("beatage_rounds")
    .select("id")
    .eq("quiz_id", quizId)
    .eq("status", "revealed");

  const roundIds = ((allRounds ?? []) as Array<{ id: string }>).map((r) => r.id);
  let leaderboard: LeaderboardRow[] = [];

  if (roundIds.length > 0) {
    const { data: allGuesses } = await admin
      .from("beatage_guesses")
      .select("user_id, points, points_total")
      .in("round_id", roundIds);

    const totals = new Map<string, number>();
    for (const g of (allGuesses ?? []) as Array<{
      user_id: string;
      points: number | null;
      points_total: number | null;
    }>) {
      const pts = g.points_total ?? g.points ?? 0;
      totals.set(g.user_id, (totals.get(g.user_id) ?? 0) + pts);
    }

    const nameByUser = new Map(
      ((members ?? []) as Array<{ user_id: string; display_name: string }>).map(
        (m) => [m.user_id, m.display_name] as const,
      ),
    );

    leaderboard = [...totals.entries()]
      .map(([userId, total_points]) => ({
        user_id: userId,
        display_name: nameByUser.get(userId) ?? "Player",
        total_points,
      }))
      .sort(
        (a, b) =>
          b.total_points - a.total_points || a.display_name.localeCompare(b.display_name),
      );
  }

  return {
    joinCode,
    currentRoundNumber,
    tracks: (tracks ?? []) as CuratedTrackRow[],
    activeRound: (activeRound as RoundRow | null) ?? null,
    resultRound: (resultRound as RoundRow | null) ?? null,
    roundGuesses,
    myGuessYear,
    leaderboard,
    memberCount: ((members ?? []) as Array<{ user_id: string }>).length,
    quizStatus,
    maxCuratedTracks,
  };
}
