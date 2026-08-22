export type ContestActivitySnapshot = {
  memberCount: number;
  revealedCount: number;
  nominationsOpen: boolean;
  votingOpen: boolean;
  contestStatus: string;
  resultsRevealStep: number;
  nominatorRevealStep: number;
};

/** True when something meaningful changed since the user last opened the contest. */
export function hasContestActivityNews(
  prev: ContestActivitySnapshot,
  next: ContestActivitySnapshot,
): boolean {
  if (next.memberCount > prev.memberCount) return true;
  if (next.revealedCount > prev.revealedCount) return true;
  if (next.nominationsOpen && !prev.nominationsOpen) return true;
  if (next.votingOpen && !prev.votingOpen) return true;
  if (next.resultsRevealStep > prev.resultsRevealStep) return true;
  if (next.nominatorRevealStep > prev.nominatorRevealStep) return true;
  if (next.contestStatus === "finished" && prev.contestStatus !== "finished") {
    return true;
  }
  return false;
}

export function contestActivitySnapshot(input: {
  memberCount: number;
  revealedCount: number;
  nominationsOpen: boolean;
  votingOpen: boolean;
  contestStatus: string;
  resultsRevealStep?: number;
  nominatorRevealStep?: number;
}): ContestActivitySnapshot {
  return {
    memberCount: input.memberCount,
    revealedCount: input.revealedCount,
    nominationsOpen: input.nominationsOpen,
    votingOpen: input.votingOpen,
    contestStatus: input.contestStatus,
    resultsRevealStep: input.resultsRevealStep ?? 0,
    nominatorRevealStep: input.nominatorRevealStep ?? 0,
  };
}
