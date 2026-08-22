"use client";

import { useMemo } from "react";
import { useFlipList } from "@/components/use-flip-list";
import type { NominatorResultRow } from "@/lib/plans";
import { podiumRankClass, podiumRowClass } from "@/lib/result-podium-styles";
import { cn } from "@/lib/utils";

type NominatorResultsProps = {
  results: NominatorResultRow[];
  waiting?: boolean;
  subtitle?: string | null;
  /** When true, show points/ranks but hide person names (birthday suspense). */
  hideIdentities?: boolean;
};

export function NominatorResults({
  results,
  waiting = false,
  subtitle,
  hideIdentities = false,
}: NominatorResultsProps) {
  const flipOrderKey = useMemo(
    () => results.map((row) => `${row.nominatorKey}:${row.rank}`).join("|"),
    [results],
  );
  const listRef = useFlipList(flipOrderKey);

  if (waiting) {
    return (
      <p className="text-sm text-muted-foreground">
        Waiting for the host to reveal the next nominator ranking step…
      </p>
    );
  }

  if (results.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No nominator results yet.</p>
    );
  }

  return (
    <div className="space-y-3">
      {subtitle ? (
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {hideIdentities
            ? "Points from nominated candidates, summed per nominator. Names are revealed after the last place."
            : "Points from nominated candidates, summed per nominator."}
        </p>
      )}
      <ol ref={listRef} className="space-y-2">
        {results.map((row) => (
          <li
            key={row.nominatorKey}
            data-flip-id={row.nominatorKey}
            className={cn(
              "relative flex items-start justify-between gap-3 rounded-lg border px-3 py-2",
              "transition-[background-color,border-color,box-shadow] duration-700 ease-out",
              podiumRowClass(row.rank),
            )}
          >
            <div className="min-w-0">
              <p className="font-medium">
                <span
                  className={cn(
                    podiumRankClass(row.rank),
                    "transition-[color,font-size] duration-700 ease-out",
                  )}
                >
                  #{row.rank}
                </span>{" "}
                {hideIdentities ? "Hidden nominator" : row.displayName}
              </p>
              <p className="text-sm text-muted-foreground">
                {row.candidateCount}/{row.candidateTotal} candidate
                {row.candidateTotal === 1 ? "" : "s"} scored
              </p>
            </div>
            <p className="shrink-0 text-sm font-medium tabular-nums">
              {row.points} pts
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
