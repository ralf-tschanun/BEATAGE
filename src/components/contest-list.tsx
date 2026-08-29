"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import {
  deleteContestAction,
  leaveContestAction,
  type ContestActionState,
} from "@/app/actions/contest";
import { CircleNotchIcon, SignOutIcon, TrashIcon } from "@phosphor-icons/react";
import {
  subscribeContestCandidates,
  subscribeContestMembers,
  subscribeContestMeta,
  type ContestLiveMeta,
} from "@/components/contest-live-refresh";
import { useContestOverviewUnread } from "@/components/use-contest-activity-unread";
import {
  getAcknowledgedContestActivity,
  setAcknowledgedContestActivity,
} from "@/lib/contest-activity-ack";
import { contestActivitySnapshot } from "@/lib/contest-activity-unread";
import { ContestPhaseStatusBadge } from "@/components/contest-phase-status-badge";
import { createClient } from "@/lib/supabase/client";
import { SiteSectionIcon } from "@/components/site-section-icon";
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
import type { DashboardContest } from "@/lib/contests/dashboard";
import type { SiteNavItemId } from "@/lib/site-nav-items";
import { cn } from "@/lib/utils";
import {
  countCandidateRevealProgress,
  phaseRevealCountsFromCandidates,
  type ContestPhaseInput,
} from "@/lib/contest-phase";
import {
  contestTypeLabel,
} from "@/lib/plans";

const initialActionState: ContestActionState = null;

type ContestRowAction = "leave" | "delete";

/** Locale-stable date for SSR/client hydration (YYYY-MM-DD). */
function formatExpiresDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type ContestListProps = {
  title: string;
  emptyText: string;
  contests: DashboardContest[];
  sectionIcon?: Extract<SiteNavItemId, "hosted" | "joined">;
  /** Swipe left (mobile) or use the row action button (desktop). */
  rowAction?: ContestRowAction;
};

function phaseInputFromContest(contest: DashboardContest): ContestPhaseInput {
  return {
    status: contest.status,
    nominationsOpen: contest.nominations_open ?? contest.status === "open",
    votingOpen: contest.voting_open === true,
    resultsPhase: contest.results_phase ?? null,
    resultsReveal: contest.results_reveal ?? null,
    resultsRevealStep: Number(contest.results_reveal_step ?? 0),
    nominatorRevealStep: Number(contest.nominator_reveal_step ?? 0),
    candidateSource: contest.candidate_source ?? null,
    nominationDurationSeconds: contest.nomination_duration_seconds ?? null,
    candidateReveal: contest.candidate_reveal ?? null,
    nominationDeadline: contest.nomination_deadline ?? null,
    votingClosesAt: contest.voting_closes_at ?? null,
  };
}

function ContestRowLinkStatus({ hasUnread }: { hasUnread: boolean }) {
  const { pending } = useLinkStatus();
  return (
    <>
      {hasUnread && !pending ? (
        <span
          className="absolute right-0 top-0.5 size-1.5 rounded-full bg-red-500 ring-2 ring-background"
          aria-hidden
        />
      ) : null}
      <span
        className={cn(
          "absolute right-0 top-0.5 inline-flex size-4 items-center justify-center text-muted-foreground",
          "opacity-0 transition-opacity duration-150",
          pending && "opacity-100 delay-100",
        )}
        aria-hidden
      >
        <CircleNotchIcon className="size-4 animate-spin" />
      </span>
      {pending ? <span className="sr-only">Loading contest</span> : null}
    </>
  );
}

function ContestRow({
  contest,
  className,
}: {
  contest: DashboardContest;
  className: string;
}) {
  const [phase, setPhase] = useState(() => phaseInputFromContest(contest));
  const [memberCount, setMemberCount] = useState(contest.member_count ?? 0);
  const [revealedCount, setRevealedCount] = useState(0);

  useEffect(() => {
    setPhase((prev) => ({
      ...phaseInputFromContest(contest),
      pendingRevealCount: prev.pendingRevealCount,
      revealedCandidateCount: prev.revealedCandidateCount,
    }));
    setMemberCount(contest.member_count ?? 0);
  }, [contest]);

  useEffect(() => {
    return subscribeContestMeta(contest.id, (meta: ContestLiveMeta) => {
      setPhase((prev) => ({
        ...prev,
        status: meta.status,
        nominationsOpen: meta.nominationsOpen,
        votingOpen: meta.votingOpen,
        resultsPhase: meta.resultsPhase,
        resultsReveal: meta.resultsReveal,
        resultsRevealStep: meta.resultsRevealStep,
        nominatorRevealStep: meta.nominatorRevealStep,
        nominationDeadline: meta.nominationDeadline,
        votingClosesAt: meta.votingClosesAt,
      }));
    });
  }, [contest.id]);

  useEffect(() => {
    return subscribeContestMembers(contest.id, (patch) => {
      if (patch.type === "replace") {
        setMemberCount(patch.members.length);
      }
    });
  }, [contest.id]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    void supabase
      .from("candidates")
      .select("id, status")
      .eq("contest_id", contest.id)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setRevealedCount(countCandidateRevealProgress(data).revealedCount);
        setPhase((prev) => ({
          ...prev,
          ...phaseRevealCountsFromCandidates(data),
        }));
      });

    const unsubscribe = subscribeContestCandidates(contest.id, (patch) => {
      if (patch.type === "replace") {
        setRevealedCount(countCandidateRevealProgress(patch.rows).revealedCount);
        setPhase((prev) => ({
          ...prev,
          ...phaseRevealCountsFromCandidates(patch.rows),
        }));
        return;
      }
      void supabase
        .from("candidates")
        .select("id, status")
        .eq("contest_id", contest.id)
        .then(({ data }) => {
          if (cancelled || !data) return;
          setRevealedCount(countCandidateRevealProgress(data).revealedCount);
          setPhase((prev) => ({
            ...prev,
            ...phaseRevealCountsFromCandidates(data),
          }));
        });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [contest.id]);

  const activitySnapshot = useMemo(
    () =>
      contestActivitySnapshot({
        memberCount,
        revealedCount,
        nominationsOpen: phase.nominationsOpen,
        votingOpen: phase.votingOpen,
        contestStatus: phase.status,
        resultsRevealStep: phase.resultsRevealStep,
        nominatorRevealStep: phase.nominatorRevealStep,
      }),
    [
      memberCount,
      revealedCount,
      phase.nominationsOpen,
      phase.votingOpen,
      phase.status,
      phase.resultsRevealStep,
      phase.nominatorRevealStep,
    ],
  );

  const { hasUnread } = useContestOverviewUnread(contest.id, activitySnapshot);

  useEffect(() => {
    if (!getAcknowledgedContestActivity(contest.id)) {
      setAcknowledgedContestActivity(contest.id, activitySnapshot);
    }
  }, [contest.id, activitySnapshot]);

  const typeLabel = contestTypeLabel({
    theme: contest.theme,
    nominationKind: contest.nomination_kind,
  });

  const unlocked = Boolean(contest.unlocked_at);
  const metaParts = [
    contest.my_display_name ? `as ${contest.my_display_name}` : null,
    memberCount > 0
      ? `${memberCount} participant${memberCount === 1 ? "" : "s"}`
      : null,
    contest.join_code ? contest.join_code : null,
    unlocked
      ? null
      : contest.expires_at
        ? `expires ${formatExpiresDate(contest.expires_at)}`
        : null,
  ].filter(Boolean);
  const metaLine = metaParts.join(" · ");

  return (
    <Link
      href={`/c/${contest.join_code}`}
      className={className}
      aria-label={hasUnread ? `${contest.title}, has updates` : undefined}
    >
      <div className="relative flex flex-col gap-1.5">
        <ContestRowLinkStatus hasUnread={hasUnread} />
        <p className="truncate pr-6 font-medium leading-snug">{contest.title}</p>
        <p
          className="truncate text-xs leading-snug text-muted-foreground"
          title={[metaLine, unlocked ? "Unlocked" : null].filter(Boolean).join(" · ")}
        >
          {metaLine}
          {unlocked ? (
            <>
              {metaParts.length > 0 ? " · " : null}
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                Unlocked
              </span>
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center justify-start gap-1.5">
          <Badge
            variant="outline"
            className="w-fit max-w-full shrink truncate"
            title={typeLabel}
          >
            {typeLabel}
          </Badge>
          <ContestPhaseStatusBadge
            contestId={contest.id}
            phase={phase}
            nominationDeadline={phase.nominationDeadline}
            votingClosesAt={phase.votingClosesAt}
          />
        </div>
      </div>
    </Link>
  );
}

function rowActionCopy(action: ContestRowAction, title: string) {
  if (action === "delete") {
    return {
      dialogTitle: "Delete contest?",
      dialogDescription: `Delete “${title}”? This removes the contest and all participants.`,
      confirmLabel: "Yes, delete permanently",
      pendingLabel: "Deleting…",
      swipeHint: "Swipe left to delete a contest.",
      actionLabel: "Delete",
    };
  }
  return {
    dialogTitle: "Leave contest?",
    dialogDescription: `Leave “${title}”? You can join again later with the invite link if seats are still available.`,
    confirmLabel: "Yes, leave",
    pendingLabel: "Leaving…",
    swipeHint: "Swipe left to leave a contest.",
    actionLabel: "Leave",
  };
}

export function ContestList({
  title,
  emptyText,
  contests,
  sectionIcon,
  rowAction,
}: ContestListProps) {
  const [actionTarget, setActionTarget] = useState<DashboardContest | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [leaveState, leaveAction, leavePending] = useActionState(
    leaveContestAction,
    initialActionState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteContestAction,
    initialActionState,
  );
  /** Avoid treating a sticky prior success as applying to the next target. */
  const sawSuccessRef = useRef(false);

  const pending = rowAction === "delete" ? deletePending : leavePending;
  const actionState = rowAction === "delete" ? deleteState : leaveState;
  const formAction = rowAction === "delete" ? deleteAction : leaveAction;
  const copy = actionTarget && rowAction ? rowActionCopy(rowAction, actionTarget.title) : null;
  const visibleContests = contests.filter((contest) => !hiddenIds.has(contest.id));

  useEffect(() => {
    if (pending) {
      // Next completed action may succeed again — allow that edge to be handled.
      sawSuccessRef.current = false;
    }
  }, [pending]);

  useEffect(() => {
    const isSuccess = Boolean(actionState?.success);
    const becameSuccess = isSuccess && !sawSuccessRef.current;
    sawSuccessRef.current = isSuccess;
    if (!becameSuccess || !actionTarget) return;

    const removedId = actionTarget.id;
    const scrollY = window.scrollY;
    setHiddenIds((prev) => {
      if (prev.has(removedId)) return prev;
      const next = new Set(prev);
      next.add(removedId);
      return next;
    });
    setActionTarget(null);
    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, left: 0, behavior: "instant" });
    });
  }, [actionState, actionTarget]);

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-3 text-lg font-semibold tracking-tight">
        {sectionIcon ? <SiteSectionIcon id={sectionIcon} size="sm" /> : null}
        {title}
      </h2>
      {visibleContests.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {visibleContests.map((contest) => {
            const unlocked = Boolean(contest.unlocked_at);
            const unlockedFrame = unlocked
              ? "border-emerald-500/55 bg-emerald-500/[0.04] shadow-[inset_0_0_0_1px_rgba(16,185,129,0.25)]"
              : "";

            if (!rowAction) {
              return (
                <li key={contest.id}>
                  <ContestRow
                    contest={contest}
                    className={cn(
                      "block rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted/40",
                      unlockedFrame,
                    )}
                  />
                </li>
              );
            }

            const actionCopy = rowActionCopy(rowAction, contest.title);
            const ActionIcon = rowAction === "delete" ? TrashIcon : SignOutIcon;

            return (
              <li
                key={contest.id}
                className={cn(
                  "flex items-stretch overflow-hidden rounded-lg border",
                  unlockedFrame,
                )}
              >
                <div className="min-w-0 flex-1">
                  <SwipeToRemoveRow
                    embedded
                    enabled
                    actionLabel={actionCopy.actionLabel}
                    onRequestRemove={() => setActionTarget(contest)}
                  >
                    <ContestRow
                      contest={contest}
                      className="-mx-3 -my-2 block px-3 py-2.5 transition-colors hover:bg-muted/40"
                    />
                  </SwipeToRemoveRow>
                </div>
                <button
                  type="button"
                  className="max-[511px]:hidden flex w-11 shrink-0 items-center justify-center border-l text-destructive transition-colors hover:bg-destructive/10"
                  aria-label={
                    rowAction === "delete"
                      ? `Delete ${contest.title}`
                      : `Leave ${contest.title}`
                  }
                  onClick={() => setActionTarget(contest)}
                >
                  <ActionIcon className="size-4" weight="bold" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {rowAction ? (
        <p className="text-xs text-muted-foreground">
          {rowActionCopy(rowAction, "").swipeHint}{" "}
          <span className="max-[511px]:hidden">
            On desktop, use the button on the right of each row.
          </span>
        </p>
      ) : null}

      <Dialog
        open={Boolean(actionTarget)}
        onOpenChange={(open) => {
          if (!open && !pending) setActionTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy?.dialogTitle}</DialogTitle>
            <DialogDescription>{copy?.dialogDescription}</DialogDescription>
          </DialogHeader>
          <form key={actionTarget?.id ?? "none"} action={formAction}>
            <input type="hidden" name="contestId" value={actionTarget?.id ?? ""} />
            <input type="hidden" name="stayOnPage" value="1" />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setActionTarget(null)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? copy?.pendingLabel : copy?.confirmLabel}
              </Button>
            </DialogFooter>
            {actionState?.error ? (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {actionState.error}
              </p>
            ) : null}
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
