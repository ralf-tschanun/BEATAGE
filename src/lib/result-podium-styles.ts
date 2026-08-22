/** Shared podium highlight for voting + nominator result rows. */
export function podiumRowClass(rank: number): string | undefined {
  if (rank === 1) {
    return "border-amber-400 bg-amber-50/80 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.45)] dark:border-amber-400/80 dark:bg-amber-500/15";
  }
  if (rank === 2) {
    return "border-slate-400 bg-slate-100/90 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.45)] dark:border-slate-300/70 dark:bg-slate-400/15";
  }
  if (rank === 3) {
    return "border-orange-400 bg-orange-50/80 shadow-[inset_0_0_0_1px_rgba(251,146,60,0.4)] dark:border-orange-400/70 dark:bg-orange-500/15";
  }
  return undefined;
}

export function podiumRankClass(rank: number): string {
  if (rank === 1) return "text-base font-bold text-amber-800 dark:text-amber-300";
  if (rank === 2) return "text-base font-bold text-slate-600 dark:text-slate-300";
  if (rank === 3) return "text-base font-bold text-orange-800 dark:text-orange-300";
  return "text-muted-foreground";
}
