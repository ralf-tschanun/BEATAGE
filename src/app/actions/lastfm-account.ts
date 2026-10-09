"use server";

import { rememberAccountLastfmUsername } from "@/lib/account-lastfm";

/** Persist a confirmed Last.fm username on the signed-in account. Guests are a no-op. */
export async function rememberLastfmUsernameAction(
  username: string,
): Promise<string | null> {
  return rememberAccountLastfmUsername(username);
}
