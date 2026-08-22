"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type DashboardLiveRefreshProps = {
  userId: string;
  contestIds: string[];
  debounceMs?: number;
};

/**
 * Soft-refreshes the dashboard when the user's contests or memberships change.
 */
export function DashboardLiveRefresh({
  userId,
  contestIds,
  debounceMs = 400,
}: DashboardLiveRefreshProps) {
  const router = useRouter();
  const timerRef = useRef<number | null>(null);
  const contestKey = contestIds.slice().sort().join(",");

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    function scheduleRefresh() {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        router.refresh();
      }, debounceMs);
    }

    function bindChannel() {
      if (cancelled) return;
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }

      let next = supabase
        .channel(`dashboard-live:${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "contest_members",
            filter: `user_id=eq.${userId}`,
          },
          scheduleRefresh,
        );

      for (const contestId of contestIds) {
        next = next.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "contests",
            filter: `id=eq.${contestId}`,
          },
          scheduleRefresh,
        );
      }

      channel = next.subscribe();
    }

    async function syncRealtimeAuth(accessToken: string | undefined | null) {
      await supabase.realtime.setAuth(accessToken ?? null);
    }

    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void (async () => {
        await syncRealtimeAuth(session?.access_token);
        if (!cancelled && !channel) {
          bindChannel();
        }
      })();
    });

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      await syncRealtimeAuth(session?.access_token);
      if (!cancelled) {
        bindChannel();
      }
    })();

    return () => {
      cancelled = true;
      authSubscription.unsubscribe();
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
      }
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [userId, contestKey, debounceMs, router, contestIds]);

  return null;
}
