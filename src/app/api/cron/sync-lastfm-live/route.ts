import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import {
  LASTFM_LIVE_CRON_LOOP_MS,
  LASTFM_LIVE_CRON_POLL_MS,
  tickLastfmLiveQuizzes,
} from "@/lib/lastfm-live-sync";

export const dynamic = "force-dynamic";
/** Inner poll loop needs a full minute; Vercel Pro default is 10s without this. */
export const maxDuration = 60;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Follow Last.fm Now Playing for armed live quizzes while the host tab is hidden.
 * Vercel invokes this every minute; we poll Last.fm every ~7s until ~52s elapsed.
 * Secure with CRON_SECRET (Authorization: Bearer … or ?secret=).
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  let ticks = 0;
  let last = {
    considered: 0,
    synced: 0,
    skipped: 0,
    errors: 0,
  };

  try {
    while (Date.now() - started < LASTFM_LIVE_CRON_LOOP_MS) {
      const tickStarted = Date.now();
      last = await tickLastfmLiveQuizzes();
      ticks += 1;
      const spent = Date.now() - tickStarted;
      const remaining = LASTFM_LIVE_CRON_LOOP_MS - (Date.now() - started);
      if (remaining < 400) break;
      await sleep(Math.min(Math.max(0, LASTFM_LIVE_CRON_POLL_MS - spent), remaining));
    }
    return NextResponse.json({ ok: true, ticks, last });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Last.fm live sync failed.";
    return NextResponse.json({ error: message, ticks, last }, { status: 500 });
  }
}
