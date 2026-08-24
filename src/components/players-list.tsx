"use client";

import { useActionState, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  removeQuizMemberAction,
  type QuizActionState,
} from "@/app/actions/quiz";
import { SwipeToRemoveRow } from "@/components/swipe-to-remove-row";
import { CollapsibleCard } from "@/components/collapsible-card";
import { broadcastQuizResync } from "@/components/quiz-live-refresh";
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
};

type PlayersListProps = {
  quizId: string;
  joinCode: string;
  members: PlayerRow[];
  currentUserId: string;
  isHost: boolean;
  maxMembers?: number | null;
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
}: PlayersListProps) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
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
            <DialogDescription>
              Joined {formatPlayerDateTime(detailTarget?.joinedAt)}
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
