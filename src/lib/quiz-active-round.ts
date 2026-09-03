import { createAdminClient } from "@/lib/supabase/admin";
import { countQuizPlanConsumedRounds } from "@/lib/quiz-tracks";
import { readQuizSettingsRuntime } from "@/lib/quiz-scoring";

/** Columns needed to close / compare the live round. */
export const ACTIVE_ROUND_COLUMNS =
  "id, round_number, track_name, artist_name, spotify_track_id, status";

export type ActiveRoundRow = {
  id: string;
  round_number: number;
  track_name: string | null;
  artist_name: string | null;
  spotify_track_id: string | null;
  status: string;
};

export function isRoundAlreadyClosedError(
  error: string | null | undefined,
): boolean {
  return Boolean(error && error.includes("ROUND_NOT_ACTIVE"));
}

/**
 * Load the single active round for a quiz.
 * maybeSingle() returns no row (PGRST116) when two live opens race — the UI then
 * looks frozen on the last revealed round (no guess form, no new Previous-round
 * rows) while new songs still appear in the host now-playing panel.
 * Extra concurrent actives are skipped (no score) so guessing can resume.
 */
export async function resolveActiveRound(
  quizId: string,
): Promise<ActiveRoundRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("beatage_rounds")
    .select(ACTIVE_ROUND_COLUMNS)
    .eq("quiz_id", quizId)
    .eq("status", "active")
    .order("round_number", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const actives = (data ?? []) as ActiveRoundRow[];
  if (actives.length === 0) return null;

  const [keep, ...extras] = actives;
  if (extras.length === 0) return keep;

  const now = new Date().toISOString();
  const extraIds = extras.map((round) => round.id);
  await admin.from("beatage_guesses").delete().in("round_id", extraIds);
  const { error: skipError } = await admin
    .from("beatage_rounds")
    .update({
      status: "skipped",
      revealed_at: now,
      guess_closes_at: now,
    })
    .in("id", extraIds);
  if (!skipError) {
    const { data: quizRow } = await admin
      .from("beatage_quizzes")
      .select("settings")
      .eq("id", quizId)
      .maybeSingle();
    const consumed = await countQuizPlanConsumedRounds(
      quizId,
      readQuizSettingsRuntime(quizRow?.settings),
    );
    await admin
      .from("beatage_quizzes")
      .update({ current_round_number: consumed, last_activity_at: now })
      .eq("id", quizId);
  }

  return keep;
}
