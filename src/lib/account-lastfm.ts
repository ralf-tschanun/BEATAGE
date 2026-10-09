import { lookupLastfmUser, normalizeLastfmUsername } from "@/lib/lastfm";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOptionalUser } from "@/lib/supabase/auth";

/**
 * Store a Last.fm username that already exists on the signed-in account.
 * Anonymous sessions are skipped — callers keep the browser copy for guests.
 * Returns the canonical Last.fm name, or null when nothing was stored.
 */
export async function rememberAccountLastfmUsername(
  username: string,
): Promise<string | null> {
  const normalized = normalizeLastfmUsername(username);
  if (!normalized) return null;

  const { user } = await getOptionalUser();
  if (!user || user.is_anonymous) return null;

  const lookup = await lookupLastfmUser(normalized);
  if (!lookup.ok) return null;

  try {
    const admin = createAdminClient();
    const canonical = lookup.username;
    const { data, error } = await admin
      .from("beatage_profiles")
      .update({
        lastfm_username: canonical,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id)
      .select("id");
    if (error) return null;
    if (!data?.length) {
      const { error: insertError } = await admin.from("beatage_profiles").insert({
        id: user.id,
        lastfm_username: canonical,
      });
      if (insertError) return null;
    }
    return canonical;
  } catch {
    return null;
  }
}

/** Last.fm username saved on the signed-in account, or "" for guests / none. */
export async function loadAccountLastfmUsername(): Promise<string> {
  try {
    const { supabase, user } = await getOptionalUser();
    if (!user || user.is_anonymous) return "";
    const { data, error } = await supabase
      .from("beatage_profiles")
      .select("lastfm_username")
      .eq("id", user.id)
      .maybeSingle();
    if (error) return "";
    return normalizeLastfmUsername(
      typeof data?.lastfm_username === "string" ? data.lastfm_username : "",
    );
  } catch {
    return "";
  }
}
