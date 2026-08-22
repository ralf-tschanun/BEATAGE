"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  removeContestMemberAction,
  type ContestActionState,
} from "@/app/actions/contest";
import {
  applyCandidateLivePatch,
  broadcastContestResync,
  subscribeBirthdaySubmits,
  subscribeContestBallots,
  subscribeContestCandidates,
  subscribeContestMembers,
  subscribeContestMeta,
  type LiveCandidateRow,
} from "@/components/contest-live-refresh";
import { ContestSectionCard } from "@/components/contest-section-card";
import { SwipeToRemoveRow } from "@/components/swipe-to-remove-row";
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
import {
  eligibleVotersInOrder,
  orderVotersForBallotReveal,
  isParticipantNomination,
  anonymousParticipantLabel,
  type BallotRevealOrder,
  type CandidateSource,
  type NominationKind,
  type ResultsReveal,
} from "@/lib/plans";
import { ADMIN_CHECKBOX_CLASS } from "@/lib/admin-ui";
import { Label } from "@/components/ui/label";

export type ParticipantRow = {
  id: string;
  userId: string;
  displayName: string;
  role: string;
  joinedAt?: string | null;
};

export type RemovedParticipantRow = {
  id: string;
  userId: string;
  displayName: string;
  joinedAt: string | null;
  removedAt: string | null;
};

export type ParticipantBallotVoter = {
  userId: string;
  updatedAt: string | null;
  /** How many question ballots this voter has submitted. */
  ballotCount?: number;
};

type ParticipantsListProps = {
  contestId: string;
  joinCode: string;
  members: ParticipantRow[];
  /** Host-only archive of participants removed from this contest. */
  removedMembers?: RemovedParticipantRow[];
  currentUserId: string;
  isHost: boolean;
  hostParticipates: boolean;
  candidateSource: CandidateSource;
  maxNominationsPerParticipant: number | null;
  initialStatus: string;
  initialVotingOpen: boolean;
  initialNominationsOpen?: boolean;
  resultsReveal: ResultsReveal;
  ballotRevealOrder?: BallotRevealOrder;
  /** When true, show Participant 1/2/… instead of real names in reveal order. */
  resultsAnonymous?: boolean;
  nominationKind?: NominationKind;
  /** User ids that already submitted a birthday (host turnout only). */
  birthdaySubmittedUserIds?: string[];
  initialResultsRevealStep: number;
  /** Known ballots (host during voting; all members once finished). */
  initialVoters: ParticipantBallotVoter[];
  /** Anything contests: number of questions that must be voted. Default 1. */
  questionCount?: number;
  initialCandidates: Array<{
    id: string;
    nominator_user_id: string | null;
    status: string;
    meta?: Record<string, unknown> | null;
  }>;
};

const initialRemoveState: ContestActionState = null;

function formatParticipantDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

function isEligibleNominator(
  role: string,
  hostParticipates: boolean,
  candidateSource: CandidateSource,
) {
  if (candidateSource === "curated" || candidateSource === "databased") {
    return role === "host";
  }
  // Combined: host can always curate; if participating, also nominates like others.
  if (candidateSource === "combined") {
    if (role === "host") return true;
    return role === "participant";
  }
  if (role === "participant") return true;
  if (role === "host") return hostParticipates;
  return false;
}

function isEligibleVoter(role: string, hostParticipates: boolean) {
  if (role === "participant") return true;
  if (role === "host") return hostParticipates;
  return false;
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

/** Completed / active states use filled badges; in-progress and idle stay outline. */
function statusBadgeVariant(prominent: boolean): "default" | "outline" {
  return prominent ? "default" : "outline";
}

/** Host first, then current user, then others by latest joined. */
function orderParticipantsForDisplay(
  members: ParticipantRow[],
  currentUserId: string,
): ParticipantRow[] {
  function rank(member: ParticipantRow): number {
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

function nominationQuotaComplete(
  count: number,
  max: number | null,
  candidateSource: CandidateSource,
): boolean {
  if (count <= 0) return false;
  if (
    (candidateSource === "user_multiple" || candidateSource === "combined") &&
    max !== null
  ) {
    return count >= max;
  }
  return true;
}

export function ParticipantsList({
  contestId,
  joinCode,
  members: initialMembers,
  removedMembers: initialRemovedMembers = [],
  currentUserId,
  isHost,
  hostParticipates,
  candidateSource,
  maxNominationsPerParticipant,
  initialStatus,
  initialVotingOpen,
  initialNominationsOpen = true,
  resultsReveal,
  ballotRevealOrder = "alphabetical",
  resultsAnonymous = false,
  nominationKind = "standard",
  birthdaySubmittedUserIds = [],
  initialResultsRevealStep,
  initialVoters,
  questionCount = 1,
  initialCandidates,
}: ParticipantsListProps) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [removedMembers, setRemovedMembers] = useState(initialRemovedMembers);
  const [candidates, setCandidates] = useState(initialCandidates);
  const [voters, setVoters] = useState(
    () =>
      new Map(
        initialVoters.map(
          (voter) =>
            [
              voter.userId,
              {
                updatedAt: voter.updatedAt,
                ballotCount: Math.max(1, voter.ballotCount ?? 1),
              },
            ] as const,
        ),
      ),
  );
  const [birthdaySubmitted, setBirthdaySubmitted] = useState(
    () => new Set(birthdaySubmittedUserIds),
  );
  const [status, setStatus] = useState(initialStatus);
  const [votingOpen, setVotingOpen] = useState(initialVotingOpen);
  const [nominationsOpen, setNominationsOpen] = useState(initialNominationsOpen);
  const [resultsStep, setResultsStep] = useState(initialResultsRevealStep);
  const [detailTarget, setDetailTarget] = useState<ParticipantRow | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ParticipantRow | null>(null);
  const [removeNominations, setRemoveNominations] = useState(false);
  const [removeState, removeAction, removePending] = useActionState(
    removeContestMemberAction,
    initialRemoveState,
  );

  useEffect(() => {
    setMembers(initialMembers);
  }, [initialMembers]);

  useEffect(() => {
    setRemovedMembers(initialRemovedMembers);
  }, [initialRemovedMembers]);

  useEffect(() => {
    setCandidates(initialCandidates);
  }, [initialCandidates]);

  useEffect(() => {
    setVoters((prev) => {
      const next = new Map(prev);
      for (const voter of initialVoters) {
        next.set(voter.userId, {
          updatedAt: voter.updatedAt,
          ballotCount: Math.max(1, voter.ballotCount ?? 1),
        });
      }
      return next;
    });
  }, [initialVoters]);

  useEffect(() => {
    setBirthdaySubmitted(new Set(birthdaySubmittedUserIds));
  }, [birthdaySubmittedUserIds]);

  useEffect(() => {
    setStatus(initialStatus);
    setVotingOpen(initialVotingOpen);
    setNominationsOpen(initialNominationsOpen);
  }, [initialStatus, initialVotingOpen, initialNominationsOpen]);

  useEffect(() => {
    setResultsStep((prev) =>
      initialResultsRevealStep >= prev ? initialResultsRevealStep : prev,
    );
  }, [initialResultsRevealStep]);

  useEffect(() => {
    if (!removeState?.success) return;
    setDetailTarget(null);
    setRemoveTarget(null);
    void broadcastContestResync(contestId);
    router.refresh();
  }, [removeState, contestId, router]);

  useEffect(() => {
    return subscribeContestCandidates(contestId, (patch) => {
      setCandidates((prev) => {
        const next = applyCandidateLivePatch(prev, patch, (row: LiveCandidateRow) => ({
          id: row.id,
          nominator_user_id: row.nominator_user_id,
          status: row.status,
          meta: row.nomination_origin
            ? { nomination_origin: row.nomination_origin }
            : null,
        }));
        return next ?? prev;
      });
    });
  }, [contestId]);

  useEffect(() => {
    return subscribeContestBallots(contestId, (patch) => {
      if (patch.type === "refresh") return;
      if (patch.type === "replace") {
        setVoters(
          new Map(
            patch.voters.map((voter) => [
              voter.voterUserId,
              {
                updatedAt: voter.updatedAt,
                ballotCount: Math.max(1, voter.ballotCount ?? 1),
              },
            ]),
          ),
        );
        return;
      }
      if (patch.type === "remove") {
        setVoters((prev) => {
          const next = new Map(prev);
          next.delete(patch.voterUserId);
          return next;
        });
        return;
      }
      setVoters((prev) => {
        const next = new Map(prev);
        const prevEntry = next.get(patch.voterUserId);
        next.set(patch.voterUserId, {
          updatedAt: patch.updatedAt,
          ballotCount: Math.max(
            1,
            patch.ballotCount ?? prevEntry?.ballotCount ?? 1,
          ),
        });
        return next;
      });
    });
  }, [contestId]);

  useEffect(() => {
    return subscribeContestMembers(contestId, (patch) => {
      if (patch.type !== "replace") return;
      setMembers((prev) => {
        const joinedAtByUserId = new Map(
          prev.map((member) => [member.userId, member.joinedAt] as const),
        );
        return patch.members.map((member) => ({
          id: member.id,
          userId: member.userId,
          displayName: member.displayName,
          role: member.role,
          joinedAt: member.joinedAt ?? joinedAtByUserId.get(member.userId) ?? null,
        }));
      });
    });
  }, [contestId]);

  useEffect(() => {
    return subscribeBirthdaySubmits(contestId, (patch) => {
      if (patch.type !== "replace") return;
      setBirthdaySubmitted(new Set(patch.submittedUserIds));
    });
  }, [contestId]);

  useEffect(() => {
    return subscribeContestMeta(contestId, (meta) => {
      setStatus(meta.status);
      setVotingOpen(meta.votingOpen);
      setNominationsOpen(meta.nominationsOpen);
      setResultsStep(meta.resultsRevealStep);
    });
  }, [contestId]);

  const hostUserId =
    members.find((member) => member.role === "host")?.userId ?? null;

  const countByUser = useMemo(() => {
    const counts = new Map<string, number>();
    for (const candidate of candidates) {
      if (
        candidate.status === "withdrawn" ||
        candidate.status === "rejected" ||
        !candidate.nominator_user_id
      ) {
        continue;
      }
      if (
        !isParticipantNomination(
          {
            nominator_user_id: candidate.nominator_user_id,
            meta: candidate.meta ?? null,
          },
          candidateSource,
          hostUserId,
        )
      ) {
        // Curated-only contests: still show host nomination turnout.
        if (candidateSource !== "curated" && candidateSource !== "databased") {
          continue;
        }
      }
      counts.set(
        candidate.nominator_user_id,
        (counts.get(candidate.nominator_user_id) ?? 0) + 1,
      );
    }
    return counts;
  }, [candidates, candidateSource, hostUserId]);

  const eligibleOrdered = useMemo(
    () =>
      orderVotersForBallotReveal(
        members.map((member) => ({
          userId: member.userId,
          role: member.role,
          displayName: member.displayName,
        })),
        hostParticipates,
        ballotRevealOrder,
        {
          submittedAtByUserId: Object.fromEntries(
            [...voters.entries()].map(([userId, entry]) => [
              userId,
              entry.updatedAt,
            ]),
          ),
          seed: contestId,
        },
      ),
    [members, hostParticipates, ballotRevealOrder, voters, contestId],
  );

  const anonymousNameByUserId = useMemo(() => {
    if (!resultsAnonymous) return null;
    const map = new Map<string, string>();
    eligibleOrdered.forEach((member, index) => {
      map.set(member.userId, anonymousParticipantLabel(index));
    });
    return map;
  }, [resultsAnonymous, eligibleOrdered]);

  const countedUserIds = useMemo(() => {
    if (resultsReveal !== "by_participant" || status !== "finished") {
      return new Set<string>();
    }
    return new Set(
      eligibleOrdered.slice(0, Math.max(0, resultsStep)).map((member) => member.userId),
    );
  }, [resultsReveal, status, eligibleOrdered, resultsStep]);

  const nextBallotUserId = useMemo(() => {
    if (resultsReveal !== "by_participant" || status !== "finished") {
      return null;
    }
    if (resultsStep < 0 || resultsStep >= eligibleOrdered.length) {
      return null;
    }
    return eligibleOrdered[resultsStep]?.userId ?? null;
  }, [resultsReveal, status, eligibleOrdered, resultsStep]);

  // Nomination / birthday submit status is visible to everyone (same labels as host).
  const showNominationStatus =
    nominationKind !== "birthday" &&
    (candidateSource === "user_single" ||
      candidateSource === "user_multiple" ||
      candidateSource === "combined" ||
      candidateSource === "curated");

  const showBirthdaySubmitStatus =
    nominationKind === "birthday" && candidateSource !== "curated";

  const showVoteStatus = status === "voting" || status === "finished";
  const nominationsClosed =
    !nominationsOpen || status === "voting" || status === "finished" || status === "expired";
  const votingClosed =
    status === "finished" || status === "expired" || (status === "voting" && !votingOpen);

  const maxForSource =
    candidateSource === "user_single"
      ? 1
      : candidateSource === "user_multiple" || candidateSource === "combined"
        ? maxNominationsPerParticipant
        : null;

  const orderedMembers = useMemo(
    () => orderParticipantsForDisplay(members, currentUserId),
    [members, currentUserId],
  );

  const orderedRemovedMembers = useMemo(
    () =>
      [...removedMembers].sort((a, b) => {
        const aRemoved = a.removedAt ? new Date(a.removedAt).getTime() : 0;
        const bRemoved = b.removedAt ? new Date(b.removedAt).getTime() : 0;
        return bRemoved - aRemoved;
      }),
    [removedMembers],
  );

  const participantCount = useMemo(
    () => eligibleVotersInOrder(members, hostParticipates).length,
    [members, hostParticipates],
  );

  function openParticipantDetail(member: ParticipantRow) {
    if (!isHost || member.role !== "participant") return;
    setDetailTarget(member);
  }

  function requestRemoveParticipant(member: ParticipantRow) {
    setDetailTarget(null);
    setRemoveNominations(false);
    setRemoveTarget(member);
  }

  const removeTargetNominationCount = removeTarget
    ? countByUser.get(removeTarget.userId) ?? 0
    : 0;

  return (
    <>
      <ContestSectionCard
        title={
          <>
            Participants{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({participantCount})
            </span>
          </>
        }
        contentClassName="p-0"
      >
        <ul className="divide-y">
          {orderedMembers.map((member) => {
          const isMe = member.userId === currentUserId;
          const eligibleNom = isEligibleNominator(
            member.role,
            hostParticipates,
            candidateSource,
          );
          const eligibleVote = isEligibleVoter(member.role, hostParticipates);
          const count = countByUser.get(member.userId) ?? 0;
          const max = maxForSource;
          const voterEntry = voters.get(member.userId);
          const ballotCount = voterEntry?.ballotCount ?? 0;
          const requiredBallots = Math.max(1, questionCount);
          const votedComplete = ballotCount >= requiredBallots;
          const votedPartial = ballotCount > 0 && !votedComplete;
          const counted = countedUserIds.has(member.userId);
          const isNextBallot = nextBallotUserId === member.userId;
          const canManageParticipant =
            isHost && member.role === "participant";

          const roleLabel = member.role === "host" ? "host" : "client";
          const nominationComplete = showBirthdaySubmitStatus
            ? birthdaySubmitted.has(member.userId)
            : nominationQuotaComplete(count, max, candidateSource);
          const nominationLabel =
            !eligibleNom
              ? null
              : showNominationStatus
                ? count > 0
                  ? candidateSource === "user_multiple" && max !== null
                    ? `${count} of ${max}`
                    : "nominated"
                  : nominationsClosed
                    ? "not nominated"
                    : "waiting"
                : showBirthdaySubmitStatus
                  ? nominationComplete
                    ? "nominated"
                    : nominationsClosed
                      ? "not nominated"
                      : "waiting"
                  : null;
          // While nominations are open, even partial/full "nominated" stays quiet;
          // after the phase closes, completed nominations become prominent.
          const nominationProminent =
            Boolean(nominationLabel) &&
            nominationsClosed &&
            nominationComplete &&
            nominationLabel !== "not nominated" &&
            nominationLabel !== "waiting";
          const voteLabel =
            showVoteStatus && eligibleVote
              ? votedComplete
                ? "voted"
                : votedPartial
                  ? "voting"
                  : votingClosed
                    ? "not voted"
                    : "waiting"
              : null;
          const voteProminent = voteLabel === "voted";

            return (
              <li key={member.id}>
                <SwipeToRemoveRow
                  enabled={canManageParticipant}
                  highlighted={isMe}
                  interactive={canManageParticipant}
                  embedded
                  onRowClick={
                    canManageParticipant
                      ? () => openParticipantDetail(member)
                      : undefined
                  }
                  onRequestRemove={() => requestRemoveParticipant(member)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="min-w-0 break-words font-medium">
                        {anonymousNameByUserId?.get(member.userId) ?? member.displayName}
                        {isMe ? (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            (you)
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center justify-end gap-1 whitespace-nowrap">
                      <CompactBadge variant="outline">{roleLabel}</CompactBadge>
                      {nominationLabel ? (
                        <CompactBadge variant={statusBadgeVariant(nominationProminent)}>
                          {nominationLabel}
                        </CompactBadge>
                      ) : null}
                      {voteLabel ? (
                        <CompactBadge variant={statusBadgeVariant(voteProminent)}>
                          {voteLabel}
                        </CompactBadge>
                      ) : null}
                      {counted ? (
                        <CompactBadge variant="default">counted</CompactBadge>
                      ) : null}
                      {isNextBallot ? (
                        <CompactBadge variant="outline">next</CompactBadge>
                      ) : null}
                    </div>
                  </div>
                </SwipeToRemoveRow>
              </li>
            );
          })}
        </ul>
      </ContestSectionCard>

      {isHost ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Tap a client for details, or swipe left to remove them from this contest.
        </p>
      ) : null}

      {isHost && orderedRemovedMembers.length > 0 ? (
        <ContestSectionCard
          className="mt-4"
          title={
            <>
              Removed users{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({orderedRemovedMembers.length})
              </span>
            </>
          }
          description="Participants you removed from this contest."
          contentClassName="p-0"
        >
          <ul className="divide-y">
            {orderedRemovedMembers.map((member) => (
              <li key={member.id} className="px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="min-w-0 break-words font-medium text-muted-foreground">
                      {member.displayName}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Removed {formatParticipantDateTime(member.removedAt)}
                    </p>
                  </div>
                  <CompactBadge variant="outline">removed</CompactBadge>
                </div>
              </li>
            ))}
          </ul>
        </ContestSectionCard>
      ) : null}

      <Dialog
        open={Boolean(detailTarget)}
        onOpenChange={(open) => {
          if (!open && !removePending) setDetailTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {detailTarget?.displayName ?? "Participant"}
            </DialogTitle>
            <DialogDescription>
              Joined {formatParticipantDateTime(detailTarget?.joinedAt)}
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
                if (detailTarget) requestRemoveParticipant(detailTarget);
              }}
            >
              Delete participant from this contest
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
            <DialogTitle>Remove participant?</DialogTitle>
            <DialogDescription>
              {removeTarget
                ? `${removeTarget.displayName} will be removed from this contest.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <form action={removeAction}>
            <input type="hidden" name="contestId" value={contestId} />
            <input type="hidden" name="joinCode" value={joinCode} />
            <input
              type="hidden"
              name="userId"
              value={removeTarget?.userId ?? ""}
            />
            {removeTargetNominationCount > 0 ? (
              <div className="mb-4 flex items-start gap-2">
                <input
                  id="remove-nominations"
                  type="checkbox"
                  name="removeNominations"
                  checked={removeNominations}
                  onChange={(event) => setRemoveNominations(event.target.checked)}
                  className={ADMIN_CHECKBOX_CLASS}
                />
                <div className="space-y-1">
                  <Label htmlFor="remove-nominations">
                    Also remove their nominated candidates
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {removeTargetNominationCount === 1
                      ? "1 candidate will be withdrawn and listed under Removed Candidates."
                      : `${removeTargetNominationCount} candidates will be withdrawn and listed under Removed Candidates.`}
                  </p>
                </div>
              </div>
            ) : null}
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
