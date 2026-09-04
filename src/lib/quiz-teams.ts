import type { QuizSettingsRuntime } from "@/lib/quiz-settings";
import { isLiveQuizSource } from "@/lib/quiz-settings";

type GuessLike = {
  user_id: string;
  display_name: string;
  guessed_year: number | null;
  guessed_was_number_one: boolean | null;
  points_total: number;
  submitted_at: string;
};

export type TeamLeaderboardRow = {
  user_id: string;
  display_name: string;
  total_points: number;
  last_round_points: number;
  kind: "team";
  members: Array<{ user_id: string; display_name: string }>;
};

export const QUIZ_TEAM_NAME_MAX = 40;

export type QuizRosterMember = {
  id?: string;
  user_id: string;
  display_name: string;
  role: string;
  joined_at?: string | null;
};

export type QuizTeamInfo = {
  id: string;
  name: string;
  sort_index: number;
  member_user_ids: string[];
  member_names: string[];
};

export type TeamRoundGroup = {
  team_id: string;
  team_name: string;
  average_points: number;
  is_own_team: boolean;
  /** Other teams for participants when “show others” is on: name + average only. */
  aggregateOnly: boolean;
  guesses: GuessLike[];
};

export function isScoringQuizMember(
  member: Pick<QuizRosterMember, "role">,
  hostParticipates: boolean,
): boolean {
  if (member.role === "host" && !hostParticipates) return false;
  return true;
}

export function scoringRoster(
  members: QuizRosterMember[],
  hostParticipates: boolean,
): QuizRosterMember[] {
  return members.filter((member) => isScoringQuizMember(member, hostParticipates));
}

export function nextDefaultTeamName(existingNames: string[]): string {
  const used = new Set(
    existingNames.map((name) => name.trim().toLowerCase()).filter(Boolean),
  );
  let n = 1;
  while (used.has(`team ${n}`)) n += 1;
  return `Team ${n}`;
}

export function uniqueTeamName(desired: string, existingNames: string[]): string {
  const trimmed = desired.trim().slice(0, QUIZ_TEAM_NAME_MAX) || "Team";
  const used = new Set(
    existingNames.map((name) => name.trim().toLowerCase()).filter(Boolean),
  );
  if (!used.has(trimmed.toLowerCase())) return trimmed;
  for (let n = 2; n < 200; n += 1) {
    const suffix = ` ${n}`;
    const next = `${trimmed.slice(0, Math.max(1, QUIZ_TEAM_NAME_MAX - suffix.length))}${suffix}`;
    if (!used.has(next.toLowerCase())) return next;
  }
  return trimmed.slice(0, QUIZ_TEAM_NAME_MAX);
}

/** Round to one decimal so 2 vs 3 players stay fair in the UI. */
export function averageTeamPoints(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

export function formatTeamScore(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function quizTeamsAreLocked(opts: {
  teamsEnabled: boolean;
  source: string;
  runtime: Pick<QuizSettingsRuntime, "quizStarted">;
  hasStartedOfficialRound: boolean;
}): boolean {
  if (!opts.teamsEnabled) return false;
  if (isLiveQuizSource(opts.source)) {
    return opts.runtime.quizStarted !== false;
  }
  return opts.hasStartedOfficialRound;
}

export function teamsOfficialStartBlockReason(opts: {
  teamsEnabled: boolean;
  teams: QuizTeamInfo[];
  scoringMembers: QuizRosterMember[];
}): string | null {
  if (!opts.teamsEnabled) return null;
  const populated = opts.teams.filter((team) => team.member_user_ids.length > 0);
  if (populated.length < 2) {
    return "Create at least two teams before starting the official quiz.";
  }
  const assigned = new Set(
    populated.flatMap((team) => team.member_user_ids),
  );
  const unassigned = opts.scoringMembers.filter(
    (member) => !assigned.has(member.user_id),
  );
  if (unassigned.length > 0) {
    return `Assign every player to a team first (${unassigned.length} still unassigned).`;
  }
  return null;
}

export function buildTeamRoundGroups(opts: {
  teams: QuizTeamInfo[];
  guesses: GuessLike[];
  viewerUserId: string;
  isHost: boolean;
  showOthers: boolean;
  lowWins: boolean;
}): TeamRoundGroup[] {
  const guessByUser = new Map(opts.guesses.map((guess) => [guess.user_id, guess]));
  const groups: TeamRoundGroup[] = [];

  for (const team of opts.teams) {
    if (team.member_user_ids.length === 0) continue;
    const isOwn = team.member_user_ids.includes(opts.viewerUserId);
    const include =
      opts.isHost || isOwn || opts.showOthers;
    if (!include) continue;

    const memberGuesses: GuessLike[] = [];
    const points: number[] = [];
    for (let i = 0; i < team.member_user_ids.length; i += 1) {
      const userId = team.member_user_ids[i];
      const guess = guessByUser.get(userId);
      const pts = guess?.points_total ?? 0;
      points.push(pts);
      memberGuesses.push(
        guess ?? {
          user_id: userId,
          display_name: team.member_names[i] ?? "Player",
          guessed_year: null,
          guessed_was_number_one: null,
          points_total: 0,
          submitted_at: "",
        },
      );
    }
    memberGuesses.sort((a, b) =>
      opts.lowWins
        ? a.points_total - b.points_total ||
          a.display_name.localeCompare(b.display_name)
        : b.points_total - a.points_total ||
          a.display_name.localeCompare(b.display_name),
    );

    const aggregateOnly = !opts.isHost && !isOwn && opts.showOthers;
    groups.push({
      team_id: team.id,
      team_name: team.name,
      average_points: averageTeamPoints(points),
      is_own_team: isOwn,
      aggregateOnly,
      guesses: aggregateOnly ? [] : memberGuesses,
    });
  }

  groups.sort((a, b) =>
    opts.lowWins
      ? a.average_points - b.average_points ||
        a.team_name.localeCompare(b.team_name)
      : b.average_points - a.average_points ||
        a.team_name.localeCompare(b.team_name),
  );
  return groups;
}

export function buildTeamLeaderboard(opts: {
  teams: QuizTeamInfo[];
  /** user_id → official total */
  totals: Map<string, number>;
  /** user_id → last official round points */
  lastRoundPts: Map<string, number>;
  lowWins: boolean;
}): TeamLeaderboardRow[] {
  const rows: TeamLeaderboardRow[] = [];
  for (const team of opts.teams) {
    if (team.member_user_ids.length === 0) continue;
    const totals = team.member_user_ids.map(
      (userId) => opts.totals.get(userId) ?? 0,
    );
    const last = team.member_user_ids.map(
      (userId) => opts.lastRoundPts.get(userId) ?? 0,
    );
    rows.push({
      user_id: team.id,
      display_name: team.name,
      total_points: averageTeamPoints(totals),
      last_round_points: averageTeamPoints(last),
      kind: "team",
      members: team.member_user_ids.map((userId, index) => ({
        user_id: userId,
        display_name: team.member_names[index] ?? "Player",
      })),
    });
  }
  rows.sort((a, b) => {
    const byPoints = opts.lowWins
      ? a.total_points - b.total_points
      : b.total_points - a.total_points;
    return byPoints || a.display_name.localeCompare(b.display_name);
  });
  return rows;
}
