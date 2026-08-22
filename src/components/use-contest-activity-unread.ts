"use client";

import { useEffect, useState } from "react";
import { getAcknowledgedContestActivity } from "@/lib/contest-activity-ack";
import {
  type ContestActivitySnapshot,
  hasContestActivityNews,
} from "@/lib/contest-activity-unread";

/**
 * Overview red dot: only when activity moved past the last acknowledged snapshot
 * (set inside the contest when all tab attention dots are cleared).
 */
export function useContestOverviewUnread(
  contestId: string,
  snapshot: ContestActivitySnapshot,
) {
  const [hasUnread, setHasUnread] = useState(false);

  useEffect(() => {
    function recompute() {
      const acknowledged = getAcknowledgedContestActivity(contestId);
      if (!acknowledged) {
        setHasUnread(false);
        return;
      }
      setHasUnread(hasContestActivityNews(acknowledged, snapshot));
    }

    recompute();

    function onAck(event: Event) {
      const detail = (event as CustomEvent<{ contestId?: string }>).detail;
      if (detail?.contestId === contestId) {
        recompute();
      }
    }

    window.addEventListener("contest-activity-ack", onAck);
    return () => window.removeEventListener("contest-activity-ack", onAck);
  }, [contestId, snapshot]);

  return { hasUnread };
}
