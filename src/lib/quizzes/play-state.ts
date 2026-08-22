import { createClient } from "@/lib/supabase/server";
import { getOptionalUser } from "@/lib/supabase/auth";

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

export async function getQuizPlayState(quizId: string, joinCode: string) {
  const supabase = await createClient();
  const { user } = await getOptionalUser();

  const [
    { data: tracks },
    { data: activeRound },
    { data: lastRevealed },
    { data: members },
  ] = await Promise.all([
    supabase
      .from("beatage_curated_tracks")
      .select(
        "id, sort_order, track_name, artist_name, release_year, original_release_year, album_art_url",
      )
      .eq("quiz_id", quizId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("beatage_rounds")
      .select(
        "id, round_number, status, track_name, artist_name, correct_release_year, original_release_year, album_art_url",
      )
      .eq("quiz_id", quizId)
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("beatage_rounds")
      .select(
        "id, round_number, status, track_name, artist_name, correct_release_year, original_release_year, album_art_url",
      )
      .eq("quiz_id", quizId)
      .eq("status", "revealed")
      .order("round_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("beatage_quiz_members")
      .select("user_id, display_name")
      .eq("quiz_id", quizId),
  ]);

  let myGuessYear: number | null = null;
  if (user && activeRound) {
    const { data: guess } = await supabase
      .from("beatage_guesses")
      .select("guessed_year")
      .eq("round_id", activeRound.id)
      .eq("user_id", user.id)
      .maybeSingle();
    myGuessYear = (guess as { guessed_year?: number } | null)?.guessed_year ?? null;
  }

  let roundGuesses: GuessRow[] = [];
  const resultRound = lastRevealed ?? null;
  if (resultRound) {
    const { data: guesses } = await supabase
      .from("beatage_guesses")
      .select("user_id, guessed_year, points_total")
      .eq("round_id", resultRound.id);

    const nameByUser = new Map(
      ((members ?? []) as Array<{ user_id: string; display_name: string }>).map(
        (m) => [m.user_id, m.display_name] as const,
      ),
    );

    roundGuesses = ((guesses ?? []) as Array<{
      user_id: string;
      guessed_year: number | null;
      points_total: number;
    }>).map((g) => ({
      user_id: g.user_id,
      display_name: nameByUser.get(g.user_id) ?? "Player",
      guessed_year: g.guessed_year,
      points_total: g.points_total,
    }));
  }

  const { data: allRounds } = await supabase
    .from("beatage_rounds")
    .select("id")
    .eq("quiz_id", quizId)
    .eq("status", "revealed");

  const roundIds = ((allRounds ?? []) as Array<{ id: string }>).map((r) => r.id);
  let leaderboard: LeaderboardRow[] = [];

  if (roundIds.length > 0) {
    const { data: allGuesses } = await supabase
      .from("beatage_guesses")
      .select("user_id, points_total")
      .in("round_id", roundIds);

    const totals = new Map<string, number>();
    for (const g of (allGuesses ?? []) as Array<{ user_id: string; points_total: number }>) {
      totals.set(g.user_id, (totals.get(g.user_id) ?? 0) + (g.points_total ?? 0));
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
      .sort((a, b) => b.total_points - a.total_points || a.display_name.localeCompare(b.display_name));
  }

  return {
    joinCode,
    tracks: (tracks ?? []) as CuratedTrackRow[],
    activeRound: (activeRound as RoundRow | null) ?? null,
    resultRound: (resultRound as RoundRow | null) ?? null,
    roundGuesses,
    myGuessYear,
    leaderboard,
  };
}
