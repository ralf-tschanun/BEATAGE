/** Shared Last.fm copy — safe for client and server. */
export const LASTFM_USER_NOT_FOUND_MESSAGE = "Last.fm user not found.";
export const LASTFM_USER_FOUND_MESSAGE = "Last.fm user found.";

export function isLastfmUserNotFoundMessage(
  message: string | null | undefined,
): boolean {
  return message === LASTFM_USER_NOT_FOUND_MESSAGE;
}

/** Case-insensitive match of two Last.fm usernames, ignoring a leading @. */
export function lastfmUsernamesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const norm = (value: string | null | undefined) =>
    (value ?? "").trim().replace(/^@/, "").toLowerCase();
  const left = norm(a);
  const right = norm(b);
  return left.length > 0 && left === right;
}
