"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  applyCandidateLivePatch,
  subscribeContestCandidates,
  subscribeContestMeta,
  type LiveCandidateRow,
} from "@/components/contest-live-refresh";
import {
  countCandidateRevealProgress,
  resolveCandidateRevealStatus,
  type CandidateRevealStatusKind,
} from "@/lib/contest-phase";
import { cn } from "@/lib/utils";

export type { CandidateRevealStatusKind };
export { countCandidateRevealProgress, resolveCandidateRevealStatus };

type ColoredCandidateRevealStatusProps = {
  kind: CandidateRevealStatusKind;
  revealedCount: number;
  totalCount: number;
  /**
   * compact: short title badge ("revealing · 2/9" / "complete").
   * full: "revealing candidates · 2 of 9 revealed".
   */
  variant?: "compact" | "full";
  className?: string;
};

/** Colored candidate-reveal phase status (amber while revealing). */
export function ColoredCandidateRevealStatus({
  kind,
  revealedCount,
  totalCount,
  variant = "full",
  className,
}: ColoredCandidateRevealStatusProps) {
  if (kind === "idle") return null;

  const sizeClass =
    variant === "compact" ? "text-xs font-medium" : "font-medium";

  if (kind === "complete") {
    return (
      <span className={cn(sizeClass, "text-destructive", className)}>
        {variant === "compact" ? "complete" : "Candidates revealed"}
      </span>
    );
  }

  if (variant === "compact") {
    return (
      <span
        className={cn(
          sizeClass,
          "text-amber-700 dark:text-amber-400",
          className,
        )}
      >
        revealing
        {totalCount > 0 ? ` · ${revealedCount}/${totalCount}` : ""}
      </span>
    );
  }

  return (
    <span className={cn(sizeClass, className)}>
      <span className="text-amber-700 dark:text-amber-400">
        revealing candidates
      </span>
      {totalCount > 0 ? (
        <span className="text-muted-foreground">
          {" "}
          · {revealedCount} of {totalCount} revealed
        </span>
      ) : null}
    </span>
  );
}

type LiveColoredCandidateRevealStatusProps = {
  contestId: string;
  needsAdminReveal: boolean;
  initialCandidates: Array<{ id: string; status: string }>;
  initialStatus: string;
  variant?: "compact" | "full";
  className?: string;
  /** When true, prefixes a " · " only if something is rendered. */
  leadingSeparator?: boolean;
  /** Shown (with leading separator) when reveal status is idle. */
  idleFallback?: ReactNode;
};

/** Live candidate-reveal status for Host Area + Candidates card. */
export function LiveColoredCandidateRevealStatus({
  contestId,
  needsAdminReveal,
  initialCandidates,
  initialStatus,
  variant = "full",
  className,
  leadingSeparator = false,
  idleFallback = null,
}: LiveColoredCandidateRevealStatusProps) {
  const [rows, setRows] = useState(initialCandidates);
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    setRows(initialCandidates);
  }, [initialCandidates]);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    return subscribeContestMeta(contestId, (meta) => {
      setStatus(meta.status);
    });
  }, [contestId]);

  useEffect(() => {
    return subscribeContestCandidates(contestId, (patch) => {
      setRows((prev) => {
        const next = applyCandidateLivePatch(prev, patch, (row: LiveCandidateRow) => ({
          id: row.id,
          status: row.status,
        }));
        return next ?? prev;
      });
    });
  }, [contestId]);

  const progress = useMemo(() => countCandidateRevealProgress(rows), [rows]);
  const kind = resolveCandidateRevealStatus({
    needsAdminReveal,
    pendingCount: progress.pendingCount,
    revealedCount: progress.revealedCount,
    votingOrLater: status === "voting" || status === "finished",
  });

  if (kind === "idle") {
    if (!idleFallback) return null;
    return (
      <>
        {leadingSeparator ? " · " : null}
        {idleFallback}
      </>
    );
  }

  return (
    <>
      {leadingSeparator ? " · " : null}
      <ColoredCandidateRevealStatus
        kind={kind}
        revealedCount={progress.revealedCount}
        totalCount={progress.totalCount}
        variant={variant}
        className={className}
      />
    </>
  );
}
