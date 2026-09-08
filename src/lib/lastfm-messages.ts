/** Shared Last.fm copy — safe for client and server. */
export const LASTFM_USER_NOT_FOUND_MESSAGE = "Last.fm user not found.";
export const LASTFM_USER_FOUND_MESSAGE = "Last.fm user found.";

export function isLastfmUserNotFoundMessage(
  message: string | null | undefined,
): boolean {
  return message === LASTFM_USER_NOT_FOUND_MESSAGE;
}
