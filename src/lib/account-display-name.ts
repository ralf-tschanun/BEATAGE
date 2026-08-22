/** Account display name for header/menu — not contest nicknames. */

type AuthUserLike = {
  email?: string | null;
  is_anonymous?: boolean;
  user_metadata?: Record<string, unknown> | null;
};

function metaDisplayName(user: AuthUserLike): string | null {
  const raw = user.user_metadata?.display_name;
  return typeof raw === "string" ? raw.trim() || null : null;
}

function isContestFallbackName(name: string | null | undefined): boolean {
  return Boolean(name && name.trim().toLowerCase() === "host");
}

/**
 * Resolve the signed-in account name for UI chrome.
 * Ignores the literal contest fallback "Host" when a better name exists.
 */
export function resolveAccountDisplayName(
  user: AuthUserLike,
  profileDisplayName?: string | null,
): string | null {
  const profileName = profileDisplayName?.trim() || null;
  const metaName = metaDisplayName(user);

  return (
    (profileName && !isContestFallbackName(profileName) ? profileName : null) ||
    (metaName && !isContestFallbackName(metaName) ? metaName : null) ||
    profileName ||
    metaName
  );
}

/** True when profiles.display_name should be restored from auth metadata. */
export function shouldRepairHostPollutedProfile(
  profileDisplayName: string | null | undefined,
  user: AuthUserLike,
): string | null {
  if (!isContestFallbackName(profileDisplayName)) return null;
  const metaName = metaDisplayName(user);
  if (!metaName || isContestFallbackName(metaName)) return null;
  return metaName.slice(0, 40);
}
