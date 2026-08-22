import { createBrowserClient } from "@supabase/ssr";

function getSupabaseKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/**
 * Browser Supabase client (singleton in the browser).
 * Realtime postgres_changes respects RLS — the websocket must carry the
 * session JWT, so callers should keep auth in sync via realtime.setAuth.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    getSupabaseKey(),
  );
}
