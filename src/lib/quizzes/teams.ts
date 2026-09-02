import { createAdminClient } from "@/lib/supabase/admin";
import { resolveQuizSettings, readQuizSettingsRuntime } from "@/lib/quiz-scoring";
import { isPreRoundNumber } from "@/lib/quiz-settings";
import {
  isScoringQuizMember,
  nextDefaultTeamName,
  quizTeamsAreLocked,
  type QuizRosterMember,
  type QuizTeamInfo,
} from "@/lib/quiz-teams";

export type LoadedQuizTeams = {
  teams: QuizTeamInfo[];
  locked: boolean;
  source: string;
  hostParticipates: boolean;
};

async function loadRoster(
  quizId: string,
): Promise<QuizRosterMember[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("beatage_quiz_members")
    .select("user_id, display_name, role")
    .eq("quiz_id", quizId);
  return ((data ?? []) as QuizRosterMember[]).map((row) => ({
    user_id: row.user_id,
    display_name: row.display_name,
    role: row.role,
  }));
}

export async function loadQuizTeams(quizId: string): Promise<LoadedQuizTeams> {
  const admin = createAdminClient();
  const [{ data: quiz }, { data: teamRows }, { data: memberRows }, { data: roundRows }] =
    await Promise.all([
      admin
        .from("beatage_quizzes")
        .select("settings, source")
        .eq("id", quizId)
        .maybeSingle(),
      admin
        .from("beatage_teams")
        .select("id, name, sort_index")
        .eq("quiz_id", quizId)
        .order("sort_index", { ascending: true }),
      admin
        .from("beatage_team_members")
        .select("team_id, user_id")
        .eq("quiz_id", quizId),
      admin
        .from("beatage_rounds")
        .select("round_number, status")
        .eq("quiz_id", quizId),
    ]);

  const settings = resolveQuizSettings(quiz?.settings);
  const runtime = readQuizSettingsRuntime(quiz?.settings);
  const source = typeof quiz?.source === "string" ? quiz.source : "curated";
  const roster = await loadRoster(quizId);
  const nameByUser = new Map(roster.map((m) => [m.user_id, m.display_name]));

  const membersByTeam = new Map<string, string[]>();
  for (const row of (memberRows ?? []) as Array<{ team_id: string; user_id: string }>) {
    const list = membersByTeam.get(row.team_id) ?? [];
    list.push(row.user_id);
    membersByTeam.set(row.team_id, list);
  }

  const teams: QuizTeamInfo[] = (
    (teamRows ?? []) as Array<{ id: string; name: string; sort_index: number }>
  ).map((team) => {
    const ids = membersByTeam.get(team.id) ?? [];
    return {
      id: team.id,
      name: team.name,
      sort_index: team.sort_index,
      member_user_ids: ids,
      member_names: ids.map((id) => nameByUser.get(id) ?? "Player"),
    };
  });

  const hasStartedOfficialRound = (
    (roundRows ?? []) as Array<{ round_number: number; status: string }>
  ).some(
    (round) =>
      !isPreRoundNumber(round.round_number, runtime) &&
      (round.status === "active" ||
        round.status === "revealed" ||
        round.status === "skipped" ||
        round.status === "excluded"),
  );

  return {
    teams,
    locked: quizTeamsAreLocked({
      teamsEnabled: settings.teamsEnabled,
      source,
      runtime,
      hasStartedOfficialRound,
    }),
    source,
    hostParticipates: settings.hostParticipates,
  };
}

export async function saveQuizTeamForHost(opts: {
  quizId: string;
  teamId?: string | null;
  name: string;
  memberUserIds: string[];
}): Promise<{ error?: string; teamId?: string }> {
  const loaded = await loadQuizTeams(opts.quizId);
  if (loaded.locked) {
    return { error: "TEAMS_LOCKED" };
  }

  const name = opts.name.trim().slice(0, 40);
  if (!name) return { error: "TEAM_NAME_REQUIRED" };

  const memberIds = [...new Set(opts.memberUserIds.filter(Boolean))];
  if (memberIds.length < 1) return { error: "TEAM_MEMBERS_REQUIRED" };

  const admin = createAdminClient();
  const roster = await loadRoster(opts.quizId);
  const rosterIds = new Set(roster.map((m) => m.user_id));
  for (const userId of memberIds) {
    if (!rosterIds.has(userId)) return { error: "MEMBER_NOT_FOUND" };
    const member = roster.find((m) => m.user_id === userId);
    if (member && !loaded.hostParticipates && member.role === "host") {
      return { error: "HOST_NOT_PLAYING" };
    }
  }

  const otherNames = loaded.teams
    .filter((team) => team.id !== opts.teamId)
    .map((team) => team.name);
  if (otherNames.some((n) => n.trim().toLowerCase() === name.toLowerCase())) {
    return { error: "TEAM_NAME_TAKEN" };
  }

  let teamId = opts.teamId?.trim() || "";
  if (teamId) {
    const existing = loaded.teams.find((team) => team.id === teamId);
    if (!existing) return { error: "TEAM_NOT_FOUND" };
    const { error: updateError } = await admin
      .from("beatage_teams")
      .update({ name })
      .eq("id", teamId)
      .eq("quiz_id", opts.quizId);
    if (updateError) return { error: updateError.message };
  } else {
    const nextIndex =
      loaded.teams.reduce((max, team) => Math.max(max, team.sort_index), -1) + 1;
    const { data: inserted, error: insertError } = await admin
      .from("beatage_teams")
      .insert({
        quiz_id: opts.quizId,
        name,
        sort_index: nextIndex,
      })
      .select("id")
      .maybeSingle();
    if (insertError || !inserted?.id) {
      return { error: insertError?.message ?? "TEAM_NOT_FOUND" };
    }
    teamId = inserted.id as string;
  }

  const stealIds = memberIds;
  if (stealIds.length > 0) {
    const { error: stealError } = await admin
      .from("beatage_team_members")
      .delete()
      .eq("quiz_id", opts.quizId)
      .in("user_id", stealIds)
      .neq("team_id", teamId);
    if (stealError) return { error: stealError.message };

    const { data: already } = await admin
      .from("beatage_team_members")
      .select("user_id")
      .eq("team_id", teamId);
    const alreadyIds = new Set(
      ((already ?? []) as Array<{ user_id: string }>).map((row) => row.user_id),
    );
    const toInsert = memberIds.filter((userId) => !alreadyIds.has(userId));
    if (toInsert.length > 0) {
      const { error: memberError } = await admin.from("beatage_team_members").insert(
        toInsert.map((userId) => ({
          team_id: teamId,
          quiz_id: opts.quizId,
          user_id: userId,
        })),
      );
      if (memberError) return { error: memberError.message };
    }

    const extraIds = [...alreadyIds].filter((userId) => !memberIds.includes(userId));
    if (extraIds.length > 0) {
      const { error: trimError } = await admin
        .from("beatage_team_members")
        .delete()
        .eq("team_id", teamId)
        .in("user_id", extraIds);
      if (trimError) return { error: trimError.message };
    }
  }

  return { teamId };
}

export async function deleteQuizTeamForHost(
  quizId: string,
  teamId: string,
): Promise<{ error?: string }> {
  const loaded = await loadQuizTeams(quizId);
  if (loaded.locked) return { error: "TEAMS_LOCKED" };
  const admin = createAdminClient();
  const { error } = await admin
    .from("beatage_teams")
    .delete()
    .eq("id", teamId)
    .eq("quiz_id", quizId);
  if (error) return { error: error.message };
  return {};
}

/** Put every unassigned scoring player into one new team (e.g. everyone vs one). */
export async function assignRemainingSoloTeamsForHost(
  quizId: string,
): Promise<{ error?: string; created?: number }> {
  const loaded = await loadQuizTeams(quizId);
  if (loaded.locked) return { error: "TEAMS_LOCKED" };

  const roster = await loadRoster(quizId);
  const scoring = roster.filter((member) =>
    isScoringQuizMember(member, loaded.hostParticipates),
  );
  const assigned = new Set(loaded.teams.flatMap((team) => team.member_user_ids));
  const remaining = scoring.filter((member) => !assigned.has(member.user_id));
  if (remaining.length === 0) return { created: 0 };

  const result = await saveQuizTeamForHost({
    quizId,
    name: nextDefaultTeamName(loaded.teams.map((team) => team.name)),
    memberUserIds: remaining.map((member) => member.user_id),
  });
  if (result.error) return { error: result.error };
  return { created: 1 };
}
