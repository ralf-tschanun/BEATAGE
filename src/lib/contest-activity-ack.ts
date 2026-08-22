import type { ContestActivitySnapshot } from "@/lib/contest-activity-unread";

const STORAGE_PREFIX = "contest-activity-ack:";

function storageKey(contestId: string): string {
  return `${STORAGE_PREFIX}${contestId}`;
}

export function getAcknowledgedContestActivity(
  contestId: string,
): ContestActivitySnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(storageKey(contestId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ContestActivitySnapshot;
    if (
      typeof parsed.memberCount !== "number" ||
      typeof parsed.revealedCount !== "number" ||
      typeof parsed.nominationsOpen !== "boolean" ||
      typeof parsed.votingOpen !== "boolean" ||
      typeof parsed.contestStatus !== "string" ||
      typeof parsed.resultsRevealStep !== "number" ||
      typeof parsed.nominatorRevealStep !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setAcknowledgedContestActivity(
  contestId: string,
  snapshot: ContestActivitySnapshot,
): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(storageKey(contestId), JSON.stringify(snapshot));
    window.dispatchEvent(
      new CustomEvent("contest-activity-ack", {
        detail: { contestId },
      }),
    );
  } catch {
    // Ignore quota / private mode errors.
  }
}
