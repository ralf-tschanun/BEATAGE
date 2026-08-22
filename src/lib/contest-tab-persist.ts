export type ContestParticipantTabId =
  | "nominate"
  | "candidates"
  | "results"
  | "participants"
  | "host";

export function isContestTabId(
  value: string,
): value is ContestParticipantTabId {
  return (
    value === "nominate" ||
    value === "candidates" ||
    value === "results" ||
    value === "participants" ||
    value === "host"
  );
}

export function parseContestTabId(
  value: string | undefined | null,
): ContestParticipantTabId | null {
  if (!value) return null;
  return isContestTabId(value) ? value : null;
}

export function contestTabCookieName(contestId: string) {
  return `mc_ctab_${contestId.replace(/-/g, "")}`;
}

export function contestTabStorageKey(contestId: string) {
  return `mc-contest-tab:${contestId}`;
}

function readTabCookie(contestId: string): ContestParticipantTabId | null {
  if (typeof document === "undefined") return null;
  const prefix = `${contestTabCookieName(contestId)}=`;
  const parts = document.cookie.split("; ");
  for (const part of parts) {
    if (part.startsWith(prefix)) {
      return parseContestTabId(decodeURIComponent(part.slice(prefix.length)));
    }
  }
  return null;
}

export function readPersistedContestTab(
  contestId: string,
): ContestParticipantTabId | null {
  if (typeof window === "undefined") return null;
  const fromHash = parseContestTabId(window.location.hash.replace(/^#/, ""));
  if (fromHash) return fromHash;
  try {
    const stored = sessionStorage.getItem(contestTabStorageKey(contestId));
    const fromStorage = parseContestTabId(stored);
    if (fromStorage) return fromStorage;
  } catch {
    // ignore
  }
  return readTabCookie(contestId);
}

export function persistContestTab(
  contestId: string,
  id: ContestParticipantTabId,
) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(contestTabStorageKey(contestId), id);
  } catch {
    // ignore
  }
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${contestTabCookieName(contestId)}=${id}; Path=/; SameSite=Lax; Max-Age=2592000${secure}`;
  const url = new URL(window.location.href);
  if (url.hash.replace(/^#/, "") === id) return;
  url.hash = id;
  window.history.replaceState(window.history.state, "", url);
}
