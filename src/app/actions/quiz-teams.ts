"use server";

import { revalidatePath } from "next/cache";
import { ensureAnonymousSession } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  assignRemainingSoloTeamsForHost,
  deleteQuizTeamForHost,
  loadQuizTeams,
  saveQuizTeamForHost,
} from "@/lib/quizzes/teams";
import type { QuizTeamInfo } from "@/lib/quiz-teams";

export type QuizTeamActionState = {
  error?: string;
  ok?: boolean;
  teams?: QuizTeamInfo[];
  syncId?: string;
} | null;

function mapTeamError(message: string): string {
  if (message.includes("TEAMS_LOCKED")) {
    return "Teams are locked because the official quiz has started.";
  }
  if (message.includes("TEAM_NAME_REQUIRED")) return "Enter a team name.";
  if (message.includes("TEAM_MEMBERS_REQUIRED")) {
    return "Select at least one player for this team.";
  }
  if (message.includes("TEAM_NAME_TAKEN")) {
    return "That team name is already in use.";
  }
  if (message.includes("TEAM_NOT_FOUND")) return "That team was not found.";
  if (message.includes("MEMBER_NOT_FOUND")) return "That player was not found.";
  if (message.includes("HOST_NOT_PLAYING")) {
    return "The host is not playing along, so they cannot join a team.";
  }
  if (message.includes("NOT_HOST")) return "Only the host can do that.";
  if (message.includes("QUIZ_NOT_FOUND")) return "That quiz was not found.";
  return message || "Something went wrong.";
}

async function assertHost(quizId: string, userId: string) {
  const admin = createAdminClient();
  const { data: quiz, error } = await admin
    .from("beatage_quizzes")
    .select("host_user_id, join_code")
    .eq("id", quizId)
    .maybeSingle();
  if (error || !quiz) throw new Error("QUIZ_NOT_FOUND");
  if (quiz.host_user_id !== userId) throw new Error("NOT_HOST");
  return quiz as { host_user_id: string; join_code: string };
}

export async function saveQuizTeamAction(
  _prev: QuizTeamActionState,
  formData: FormData,
): Promise<QuizTeamActionState> {
  const quizId = String(formData.get("quizId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();
  const teamId = String(formData.get("teamId") ?? "").trim();
  const name = String(formData.get("teamName") ?? "").trim();
  const memberUserIds = formData
    .getAll("memberUserId")
    .map((value) => String(value).trim())
    .filter(Boolean);

  if (!quizId) return { error: "Missing quiz id." };

  try {
    const { user } = await ensureAnonymousSession();
    await assertHost(quizId, user.id);
    const result = await saveQuizTeamForHost({
      quizId,
      teamId: teamId || null,
      name,
      memberUserIds,
    });
    if (result.error) return { error: mapTeamError(result.error) };
    const loaded = await loadQuizTeams(quizId);
    revalidatePath(`/q/${joinCode || ""}`);
    return { ok: true, teams: loaded.teams, syncId: crypto.randomUUID() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapTeamError(message) };
  }
}

export async function deleteQuizTeamAction(
  _prev: QuizTeamActionState,
  formData: FormData,
): Promise<QuizTeamActionState> {
  const quizId = String(formData.get("quizId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();
  const teamId = String(formData.get("teamId") ?? "").trim();
  if (!quizId || !teamId) return { error: "Missing team." };

  try {
    const { user } = await ensureAnonymousSession();
    await assertHost(quizId, user.id);
    const result = await deleteQuizTeamForHost(quizId, teamId);
    if (result.error) return { error: mapTeamError(result.error) };
    const loaded = await loadQuizTeams(quizId);
    revalidatePath(`/q/${joinCode || ""}`);
    return { ok: true, teams: loaded.teams, syncId: crypto.randomUUID() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapTeamError(message) };
  }
}

export async function assignRemainingSoloTeamsAction(
  _prev: QuizTeamActionState,
  formData: FormData,
): Promise<QuizTeamActionState> {
  const quizId = String(formData.get("quizId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();
  if (!quizId) return { error: "Missing quiz id." };

  try {
    const { user } = await ensureAnonymousSession();
    await assertHost(quizId, user.id);
    const result = await assignRemainingSoloTeamsForHost(quizId);
    if (result.error) return { error: mapTeamError(result.error) };
    const loaded = await loadQuizTeams(quizId);
    revalidatePath(`/q/${joinCode || ""}`);
    return { ok: true, teams: loaded.teams, syncId: crypto.randomUUID() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapTeamError(message) };
  }
}
