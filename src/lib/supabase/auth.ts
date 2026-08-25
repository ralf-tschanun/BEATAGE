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

/** Network / DNS blips should not crash the whole page. */
function isTransientAuthFetchError(message: string | undefined) {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes("fetch failed") ||
    normalized.includes("network") ||
    normalized.includes("enotfound") ||
    normalized.includes("econnrefused") ||
    normalized.includes("econnreset") ||
    normalized.includes("etimedout") ||
    normalized.includes("certificate")
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
  if (
    userError &&
    !isMissingSessionError(userError.message) &&
    !isTransientAuthFetchError(userError.message)
  ) {
    throw new Error(userError.message);
  }
  if (userError && isTransientAuthFetchError(userError.message)) {
    throw new Error(
      "Cannot reach Supabase (network/DNS). Check your connection and NEXT_PUBLIC_SUPABASE_URL.",
    );
  }

  if (user) {
    return { supabase, user };
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    if (error && isTransientAuthFetchError(error.message)) {
      throw new Error(
        "Cannot reach Supabase (network/DNS). Check your connection and NEXT_PUBLIC_SUPABASE_URL.",
      );
    }
    throw new Error(
      error?.message ??
        "Anonymous sign-in failed. Enable Anonymous Sign-Ins in the Supabase dashboard.",
    );
  }

  return { supabase, user: data.user };
}

/** Read the current user if a session cookie exists; otherwise null. */
export async function getOptionalUser(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: Awaited<
    ReturnType<Awaited<ReturnType<typeof createClient>>["auth"]["getUser"]>
  >["data"]["user"];
  /** False when Supabase could not be reached (DNS/network/suspended). */
  supabaseReachable: boolean;
}> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error && isTransientAuthFetchError(error.message)) {
      return { supabase, user: null, supabaseReachable: false };
    }

    if (error && !isMissingSessionError(error.message)) {
      throw new Error(error.message);
    }

    return { supabase, user: user ?? null, supabaseReachable: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isTransientAuthFetchError(message)) {
      const supabase = await createClient();
      return { supabase, user: null, supabaseReachable: false };
    }
    throw error;
  }
}
