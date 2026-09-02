"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  assignRemainingSoloTeamsAction,
  deleteQuizTeamAction,
  saveQuizTeamAction,
} from "@/app/actions/quiz-teams";
import { CollapsibleCard } from "@/components/collapsible-card";
import { broadcastQuizResync } from "@/components/quiz-live-refresh";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  nextDefaultTeamName,
  scoringRoster,
  teamsOfficialStartBlockReason,
  type QuizRosterMember,
  type QuizTeamInfo,
} from "@/lib/quiz-teams";

type QuizTeamsPanelProps = {
  quizId: string;
  joinCode: string;
  isHost: boolean;
  currentUserId: string;
  hostParticipates: boolean;
  locked: boolean;
  teams: QuizTeamInfo[];
  roster: QuizRosterMember[];
  onTeamsChange?: (teams: QuizTeamInfo[]) => void;
};

export function QuizTeamsPanel({
  quizId,
  joinCode,
  isHost,
  currentUserId,
  hostParticipates,
  locked,
  teams,
  roster,
  onTeamsChange,
}: QuizTeamsPanelProps) {
  const scoring = useMemo(
    () => scoringRoster(roster, hostParticipates),
    [roster, hostParticipates],
  );
  const assignedIds = useMemo(
    () => new Set(teams.flatMap((team) => team.member_user_ids)),
    [teams],
  );
  const unassigned = scoring.filter((member) => !assignedIds.has(member.user_id));
  const blockReason = teamsOfficialStartBlockReason({
    teamsEnabled: true,
    teams,
    scoringMembers: scoring,
  });
  const ownTeam = teams.find((team) =>
    team.member_user_ids.includes(currentUserId),
  );

  if (!isHost) {
    return (
      <CollapsibleCard
        sectionId={`quiz-${quizId}-teams`}
        title="Teams"
        description={
          ownTeam
            ? `You are on ${ownTeam.name}`
            : locked
              ? "Waiting for the host"
              : "The host is assigning teams"
        }
        defaultOpen
      >
        {teams.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Teams will show up here once the host saves them.
          </p>
        ) : (
          <ul className="space-y-3 text-sm">
            {teams.map((team) => (
              <li key={team.id}>
                <p className="font-medium">
                  {team.name}
                  {team.member_user_ids.includes(currentUserId) ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      (your team)
                    </span>
                  ) : null}
                </p>
                <p className="text-muted-foreground">
                  {team.member_names.join(" · ") || "No players yet"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleCard>
    );
  }

  return (
    <HostTeamsBuilder
      quizId={quizId}
      joinCode={joinCode}
      locked={locked}
      teams={teams}
      scoring={scoring}
      unassigned={unassigned}
      blockReason={blockReason}
      hostParticipates={hostParticipates}
      currentUserId={currentUserId}
      onTeamsChange={onTeamsChange}
    />
  );
}

function HostTeamsBuilder({
  quizId,
  joinCode,
  locked,
  teams,
  scoring,
  unassigned,
  blockReason,
  hostParticipates,
  currentUserId,
  onTeamsChange,
}: {
  quizId: string;
  joinCode: string;
  locked: boolean;
  teams: QuizTeamInfo[];
  scoring: QuizRosterMember[];
  unassigned: QuizRosterMember[];
  blockReason: string | null;
  hostParticipates: boolean;
  currentUserId: string;
  onTeamsChange?: (teams: QuizTeamInfo[]) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState(nextDefaultTeamName(teams.map((t) => t.name)));
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<"save" | "delete" | "solo" | null>(
    null,
  );

  function resetComposer(nextTeams: QuizTeamInfo[]) {
    setEditingId(null);
    setSelected([]);
    setTeamName(nextDefaultTeamName(nextTeams.map((t) => t.name)));
  }

  async function runTeamAction(
    kind: "save" | "delete" | "solo",
    action: typeof saveQuizTeamAction,
    formData: FormData,
  ) {
    setBusyKind(kind);
    setError(null);
    try {
      const next = await action(null, formData);
      if (next?.error) {
        setError(next.error);
        return;
      }
      const nextTeams = next?.teams ?? teams;
      if (next?.teams) onTeamsChange?.(next.teams);
      resetComposer(nextTeams);
      void broadcastQuizResync(quizId, joinCode);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Something went wrong.",
      );
    } finally {
      setBusyKind(null);
    }
  }

  function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runTeamAction("save", saveQuizTeamAction, new FormData(event.currentTarget));
  }

  function onDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runTeamAction(
      "delete",
      deleteQuizTeamAction,
      new FormData(event.currentTarget),
    );
  }

  function onSolo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runTeamAction(
      "solo",
      assignRemainingSoloTeamsAction,
      new FormData(event.currentTarget),
    );
  }

  function startEdit(team: QuizTeamInfo) {
    setEditingId(team.id);
    setTeamName(team.name);
    setSelected([...team.member_user_ids]);
  }

  function cancelEdit() {
    resetComposer(teams);
  }

  function toggleMember(userId: string) {
    setSelected((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  }

  const selectable = scoring.filter((member) => {
    if (selected.includes(member.user_id)) return true;
    if (editingId) {
      const owner = teams.find((team) => team.member_user_ids.includes(member.user_id));
      return !owner || owner.id === editingId;
    }
    return !assignedHas(teams, member.user_id) || selected.includes(member.user_id);
  });

  const busy = busyKind != null;
  const savePending = busyKind === "save";
  const soloPending = busyKind === "solo";

  return (
    <CollapsibleCard
      sectionId={`quiz-${quizId}-teams`}
      title="Teams"
      description={
        locked ? (
          <span>Locked — the official quiz has started.</span>
        ) : blockReason ? (
          <span className="text-amber-800 dark:text-amber-400">{blockReason}</span>
        ) : (
          <span>
            {teams.length} team{teams.length === 1 ? "" : "s"} ·{" "}
            {scoring.length - unassigned.length}/{scoring.length} assigned
          </span>
        )
      }
      defaultOpen={!locked}
    >
      <div className="space-y-4">
        {teams.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Create teams, pick players, then start the official quiz. Solo teams
            are allowed.
          </p>
        ) : (
          <ul className="space-y-2">
            {teams.map((team) => (
              <li
                key={team.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-border/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="font-medium">{team.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {team.member_names.join(" · ") || "No players"}
                  </p>
                </div>
                {locked ? null : (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => startEdit(team)}
                    >
                      Edit
                    </Button>
                    <form onSubmit={onDelete}>
                      <input type="hidden" name="quizId" value={quizId} />
                      <input type="hidden" name="joinCode" value={joinCode} />
                      <input type="hidden" name="teamId" value={team.id} />
                      <Button
                        type="submit"
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={busy}
                      >
                        Remove
                      </Button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {locked ? null : (
          <>
            <form onSubmit={onSave} className="space-y-3 rounded-xl border border-border/60 p-3">
              <input type="hidden" name="quizId" value={quizId} />
              <input type="hidden" name="joinCode" value={joinCode} />
              {editingId ? (
                <input type="hidden" name="teamId" value={editingId} />
              ) : null}
              {selected.map((userId) => (
                <input key={userId} type="hidden" name="memberUserId" value={userId} />
              ))}
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="teamName">{editingId ? "Edit team" : "New team"}</Label>
              </div>
              <Input
                id="teamName"
                name="teamName"
                value={teamName}
                maxLength={40}
                onChange={(event) => setTeamName(event.target.value)}
                placeholder="Team 1"
              />
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Players
                </p>
                {selectable.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {scoring.length === 0
                      ? "Waiting for players to join."
                      : "All players are already on a team."}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {selectable.map((member) => {
                      const on = selected.includes(member.user_id);
                      const takenElsewhere =
                        assignedHas(teams, member.user_id) &&
                        !teams.some(
                          (team) =>
                            team.id === editingId &&
                            team.member_user_ids.includes(member.user_id),
                        );
                      return (
                        <button
                          key={member.user_id}
                          type="button"
                          onClick={() => toggleMember(member.user_id)}
                          className={cn(
                            "rounded-full border px-3 py-1 text-sm transition-colors",
                            on
                              ? "border-primary bg-primary/10"
                              : takenElsewhere
                                ? "border-border/40 text-muted-foreground"
                                : "border-border/60 hover:bg-muted/40",
                          )}
                        >
                          {member.display_name}
                          {member.user_id === currentUserId ? " (you)" : ""}
                        </button>
                      );
                    })}
                  </div>
                )}
                {!hostParticipates ? (
                  <p className="text-xs text-muted-foreground">
                    You host only, so you stay off the teams.
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy || selected.length < 1 || !teamName.trim()}>
                  {savePending ? "Saving…" : "Save team"}
                </Button>
                {editingId ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={cancelEdit}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            </form>
            {unassigned.length > 0 ? (
              <form onSubmit={onSolo}>
                <input type="hidden" name="quizId" value={quizId} />
                <input type="hidden" name="joinCode" value={joinCode} />
                <Button type="submit" variant="outline" disabled={busy}>
                  {soloPending
                    ? "Assigning…"
                    : `Put remaining in one team (${unassigned.length})`}
                </Button>
              </form>
            ) : null}
          </>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </CollapsibleCard>
  );
}

function assignedHas(teams: QuizTeamInfo[], userId: string): boolean {
  return teams.some((team) => team.member_user_ids.includes(userId));
}
