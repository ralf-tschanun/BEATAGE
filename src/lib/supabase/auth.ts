import { createClient } from "@/lib/supabase/server";

function isMissingSessionError(message: string | undefined) {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes("auth session missing") ||
    normalized.includes("session from session") ||
    normalized.includes("not authenticated")
  );
}

/**
 * Ensures the visitor has a Supabase session.
 * Uses anonymous auth for guest-first create/join (no login UI).
 * Enable Anonymous Sign-Ins in Supabase → Authentication → Providers.
 *
 * Prefer calling this from Server Actions (cookie writes are reliable there).
 */
export async function ensureAnonymousSession() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  // No cookie yet is normal for first-time guests — sign in anonymously.
  if (userError && !isMissingSessionError(userError.message)) {
    throw new Error(userError.message);
  }

  if (user) {
    return { supabase, user };
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    throw new Error(
      error?.message ??
        "Anonymous sign-in failed. Enable Anonymous Sign-Ins in the Supabase dashboard.",
    );
  }

  return { supabase, user: data.user };
}

/** Read the current user if a session cookie exists; otherwise null. */
export async function getOptionalUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error && !isMissingSessionError(error.message)) {
    throw new Error(error.message);
  }

  return { supabase, user: user ?? null };
}
