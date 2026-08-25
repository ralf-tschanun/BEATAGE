"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  deleteQuizAction,
  leaveQuizAction,
  type QuizActionState,
} from "@/app/actions/quiz";
import { MedalIcon, SignOutIcon, TrashIcon, TrophyIcon } from "@phosphor-icons/react";
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
import type { DashboardQuiz } from "@/lib/quizzes/dashboard";
import { quizSourceLabel } from "@/lib/quiz-settings";
import type { SiteNavItemId } from "@/lib/site-nav-items";
import { cn } from "@/lib/utils";

function QuizPlacementBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300"
        title="1st place"
        aria-label="1st place"
      >
        <TrophyIcon className="size-5" weight="fill" aria-hidden />
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-400/20 text-slate-600 dark:text-slate-300"
        title="2nd place"
        aria-label="2nd place"
      >
        <MedalIcon className="size-5" weight="fill" aria-hidden />
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-orange-800 dark:text-orange-300"
        title="3rd place"
        aria-label="3rd place"
      >
        <MedalIcon className="size-5" weight="fill" aria-hidden />
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full bg-muted/80 px-2 text-sm font-semibold tabular-nums text-muted-foreground"
      title={`#${rank}`}
      aria-label={`Place #${rank}`}
    >
      #{rank}
    </span>
  );
}

const initialActionState: QuizActionState = null;

type QuizRowAction = "leave" | "delete";

function formatExpiresDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type QuizListProps = {
  title: string;
  emptyText: string;
  quizzes: DashboardQuiz[];
  sectionIcon?: Extract<SiteNavItemId, "hosted" | "joined">;
  /** Swipe left (mobile) or use the row action button (desktop). */
  rowAction?: QuizRowAction;
};

function QuizRow({
  quiz,
  className,
}: {
  quiz: DashboardQuiz;
  className?: string;
}) {
  const myRank =
    typeof quiz.my_rank === "number" &&
    Number.isFinite(quiz.my_rank) &&
    quiz.my_rank >= 1
      ? Math.round(quiz.my_rank)
      : null;

  return (
    <Link
      href={`/q/${quiz.join_code}`}
      className={cn(
        "flex items-center gap-3 px-4 py-4 transition-colors hover:bg-muted/40",
        className,
      )}
    >
      <div className="min-w-0 flex-1 space-y-2 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:space-y-0">
        <div className="min-w-0 space-y-1">
          <p className="truncate font-medium">{quiz.title}</p>
          <p className="text-sm text-muted-foreground">
            {quizSourceLabel(quiz.source)} · code {quiz.join_code}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Badge variant="secondary">{quiz.status}</Badge>
          {quiz.status === "payment_pending" ? (
            <span className="text-xs font-medium text-primary">Finish unlock</span>
          ) : null}
          {quiz.member_count != null ? (
            <span className="text-xs text-muted-foreground">
              {quiz.member_count}
              {quiz.max_members != null ? ` / ${quiz.max_members}` : ""} players
            </span>
          ) : null}
          {quiz.expires_at ? (
            <span className="text-xs text-muted-foreground">
              expires {formatExpiresDate(quiz.expires_at)}
            </span>
          ) : null}
        </div>
      </div>
      {myRank != null ? <QuizPlacementBadge rank={myRank} /> : null}
    </Link>
  );
}

function rowActionCopy(action: QuizRowAction, title: string) {
  if (action === "delete") {
    return {
      dialogTitle: "Delete quiz?",
      dialogDescription: `Delete “${title}”? This removes the quiz and all players.`,
      confirmLabel: "Yes, delete permanently",
      pendingLabel: "Deleting…",
      swipeHint: "Swipe left to delete a quiz.",
      actionLabel: "Delete",
    };
  }
  return {
    dialogTitle: "Leave quiz?",
    dialogDescription: `Leave “${title}”? You can join again later with the invite link if seats are still available.`,
    confirmLabel: "Yes, leave",
    pendingLabel: "Leaving…",
    swipeHint: "Swipe left to leave a quiz.",
    actionLabel: "Leave",
  };
}

export function QuizList({
  title,
  emptyText,
  quizzes,
  sectionIcon,
  rowAction,
}: QuizListProps) {
  const [actionTarget, setActionTarget] = useState<DashboardQuiz | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [leaveState, leaveAction, leavePending] = useActionState(
    leaveQuizAction,
    initialActionState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteQuizAction,
    initialActionState,
  );
  const sawSuccessRef = useRef(false);

  const pending = rowAction === "delete" ? deletePending : leavePending;
  const actionState = rowAction === "delete" ? deleteState : leaveState;
  const formAction = rowAction === "delete" ? deleteAction : leaveAction;
  const copy = actionTarget && rowAction ? rowActionCopy(rowAction, actionTarget.title) : null;
  const visibleQuizzes = quizzes.filter((quiz) => !hiddenIds.has(quiz.id));

  useEffect(() => {
    if (pending) {
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

      {visibleQuizzes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-card/40">
          {visibleQuizzes.map((quiz) => {
            if (!rowAction) {
              return (
                <li key={quiz.id}>
                  <QuizRow quiz={quiz} />
                </li>
              );
            }

            const actionCopy = rowActionCopy(rowAction, quiz.title);
            const ActionIcon = rowAction === "delete" ? TrashIcon : SignOutIcon;

            return (
              <li
                key={quiz.id}
                className="flex items-stretch overflow-hidden"
              >
                <div className="min-w-0 flex-1">
                  <SwipeToRemoveRow
                    embedded
                    enabled
                    actionLabel={actionCopy.actionLabel}
                    onRequestRemove={() => setActionTarget(quiz)}
                  >
                    <QuizRow quiz={quiz} className="-mx-4" />
                  </SwipeToRemoveRow>
                </div>
                <button
                  type="button"
                  className="max-[511px]:hidden flex w-11 shrink-0 items-center justify-center border-l text-destructive transition-colors hover:bg-destructive/10"
                  aria-label={
                    rowAction === "delete"
                      ? `Delete ${quiz.title}`
                      : `Leave ${quiz.title}`
                  }
                  onClick={() => setActionTarget(quiz)}
                >
                  <ActionIcon className="size-4" weight="bold" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {rowAction && visibleQuizzes.length > 0 ? (
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
            <input type="hidden" name="quizId" value={actionTarget?.id ?? ""} />
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
