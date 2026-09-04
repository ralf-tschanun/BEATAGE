"use client";

import { useActionState, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  removeQuizMemberAction,
  type QuizActionState,
} from "@/app/actions/quiz";
import { SwipeToRemoveRow } from "@/components/swipe-to-remove-row";
import { CollapsibleCard } from "@/components/collapsible-card";
import {
  broadcastQuizResync,
  subscribeQuizGuesses,
  subscribeQuizPlay,
} from "@/components/quiz-live-refresh";
import type { QuizTeamInfo } from "@/lib/quiz-teams";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type PlayerRow = {
  id: string;
  userId: string;
  displayName: string;
  role: string;
  joinedAt?: string | null;
  /** Latest guess submission for this quiz (any round). */
  lastSubmittedAt?: string | null;
};

type PlayersListProps = {
  quizId: string;
  joinCode: string;
  members: PlayerRow[];
  currentUserId: string;
  isHost: boolean;
  maxMembers?: number | null;
  teamsEnabled?: boolean;
  teams?: QuizTeamInfo[];
};

const initialRemoveState: QuizActionState = null;

function formatPlayerDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

function orderPlayersForDisplay(
  members: PlayerRow[],
  currentUserId: string,
): PlayerRow[] {
  function rank(member: PlayerRow): number {
    if (member.role === "host") return 0;
    if (member.userId === currentUserId) return 1;
    return 2;
  }

  return [...members].sort((a, b) => {
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    const aJoined = a.joinedAt ? new Date(a.joinedAt).getTime() : 0;
    const bJoined = b.joinedAt ? new Date(b.joinedAt).getTime() : 0;
    return bJoined - aJoined;
  });
}

function teamNameForUser(
  teams: QuizTeamInfo[],
  userId: string,
): string | null {
  const team = teams.find((row) => row.member_user_ids.includes(userId));
  const name = team?.name?.trim();
  return name || null;
}

function CompactBadge({
  children,
  variant = "outline",
}: {
  children: ReactNode;
  variant?: "default" | "secondary" | "outline";
}) {
  return (
    <Badge variant={variant} className="h-5 px-1.5 text-[10px] uppercase tracking-wide">
      {children}
    </Badge>
  );
}

export function PlayersList({
  quizId,
  joinCode,
  members: initialMembers,
  currentUserId,
  isHost,
  maxMembers = null,
  teamsEnabled = false,
  teams: initialTeams = [],
}: PlayersListProps) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [teams, setTeams] = useState(initialTeams);
  const [teamsOn, setTeamsOn] = useState(teamsEnabled);
  const [detailTarget, setDetailTarget] = useState<PlayerRow | null>(null);
  const [removeTarget, setRemoveTarget] = useState<PlayerRow | null>(null);
  const [removeState, removeAction, removePending] = useActionState(
    removeQuizMemberAction,
    initialRemoveState,
  );

  useEffect(() => {
    setMembers(initialMembers);
  }, [initialMembers]);

  useEffect(() => {
    setTeams(initialTeams);
    setTeamsOn(teamsEnabled);
  }, [initialTeams, teamsEnabled]);

  useEffect(() => {
    return subscribeQuizPlay(quizId, (patch) => {
      if (patch.type !== "replace") return;
      setMembers((prev) => {
        const previousByUserId = new Map(
          prev.map((member) => [member.userId, member] as const),
        );
        return (patch.snapshot.roster ?? []).map((member) => {
          const previous = previousByUserId.get(member.user_id);
          return {
            id: member.id ?? previous?.id ?? member.user_id,
            userId: member.user_id,
            displayName: member.display_name,
            role: member.role,
            joinedAt: member.joined_at ?? previous?.joinedAt ?? null,
            lastSubmittedAt: previous?.lastSubmittedAt ?? null,
          };
        });
      });
      setTeams(patch.snapshot.teams ?? []);
      setTeamsOn(Boolean(patch.snapshot.settings?.teamsEnabled));
    });
  }, [quizId]);

  // Keep "Last submitted" fresh while the host stays on the page (guesses
  // do not trigger a full RSC refresh).
  useEffect(() => {
    if (!isHost) return;
    return subscribeQuizGuesses(quizId, (patch) => {
      const at = new Date().toISOString();
      setMembers((prev) =>
        prev.map((member) =>
          member.userId === patch.userId
            ? { ...member, lastSubmittedAt: at }
            : member,
        ),
      );
      setDetailTarget((prev) =>
        prev && prev.userId === patch.userId
          ? { ...prev, lastSubmittedAt: at }
          : prev,
      );
    });
  }, [isHost, quizId]);

  useEffect(() => {
    if (!removeState?.success) return;
    setDetailTarget(null);
    setRemoveTarget(null);
    void broadcastQuizResync(quizId, joinCode);
    router.refresh();
  }, [removeState, quizId, joinCode, router]);

  const orderedMembers = useMemo(
    () => orderPlayersForDisplay(members, currentUserId),
    [members, currentUserId],
  );

  function openPlayerDetail(member: PlayerRow) {
    if (!isHost || member.role !== "participant") return;
    setDetailTarget(member);
  }

  function requestRemovePlayer(member: PlayerRow) {
    setDetailTarget(null);
    setRemoveTarget(member);
  }

  return (
    <>
      <CollapsibleCard
        sectionId={`quiz-${quizId}-players`}
        defaultOpen={false}
        title={
          <>
            Players{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({members.length}
              {maxMembers != null ? ` / ${maxMembers}` : ""})
            </span>
          </>
        }
        contentClassName="pt-0"
      >
        {orderedMembers.length > 0 ? (
          <ul className="divide-y divide-border/60 text-sm">
            {orderedMembers.map((member) => {
              const isMe = member.userId === currentUserId;
              const canManagePlayer = isHost && member.role === "participant";
              const roleLabel = member.role === "host" ? "host" : "player";
              const teamName = teamsOn
                ? teamNameForUser(teams, member.userId)
                : null;

              return (
                <li key={member.id}>
                  <SwipeToRemoveRow
                    enabled={canManagePlayer}
                    interactive={canManagePlayer}
                    embedded
                    contentClassName="px-0 py-2"
                    onRowClick={
                      canManagePlayer ? () => openPlayerDetail(member) : undefined
                    }
                    onRequestRemove={() => requestRemovePlayer(member)}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{member.displayName}</span>
                        {isMe ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (you)
                          </span>
                        ) : null}
                        {teamName ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            ({teamName})
                          </span>
                        ) : null}
                      </p>
                      <CompactBadge variant="outline">{roleLabel}</CompactBadge>
                    </div>
                  </SwipeToRemoveRow>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {isHost
              ? "You are the host — share the invite code to add players."
              : "No players yet."}
          </p>
        )}

        {isHost ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Tap a player for details, or swipe left to remove them from this quiz.
          </p>
        ) : null}
      </CollapsibleCard>

      <Dialog
        open={Boolean(detailTarget)}
        onOpenChange={(open) => {
          if (!open && !removePending) setDetailTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{detailTarget?.displayName ?? "Player"}</DialogTitle>
            <DialogDescription className="space-y-1">
              <span className="block">
                Joined {formatPlayerDateTime(detailTarget?.joinedAt)}
              </span>
              <span className="block">
                Last submitted{" "}
                {detailTarget?.lastSubmittedAt
                  ? formatPlayerDateTime(detailTarget.lastSubmittedAt)
                  : "Never"}
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDetailTarget(null)}
            >
              OK
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (detailTarget) requestRemovePlayer(detailTarget);
              }}
            >
              Delete player from this quiz
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => {
          if (!open && !removePending) setRemoveTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove player?</DialogTitle>
            <DialogDescription>
              {removeTarget
                ? `${removeTarget.displayName} will be removed from this quiz.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <form action={removeAction}>
            <input type="hidden" name="quizId" value={quizId} />
            <input type="hidden" name="joinCode" value={joinCode} />
            <input
              type="hidden"
              name="userId"
              value={removeTarget?.userId ?? ""}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={removePending}
                onClick={() => setRemoveTarget(null)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={removePending}>
                {removePending ? "Removing…" : "Remove"}
              </Button>
            </DialogFooter>
          </form>
          {removeState?.error ? (
            <p className="text-sm text-destructive" role="alert">
              {removeState.error}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
