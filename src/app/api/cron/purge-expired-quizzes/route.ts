import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCronAuthorized } from "@/lib/cron-auth";

/**
 * Scheduled / manual cleanup: delete quizzes past expires_at.
 * Secure with CRON_SECRET (Authorization: Bearer … or ?secret=).
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("beatage_purge_expired_quizzes");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data ?? { ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Purge failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
