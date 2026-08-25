import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Scheduled / manual cleanup: delete quizzes past expires_at.
 * Secure with CRON_SECRET (Authorization: Bearer … or ?secret=).
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization")?.trim() ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const querySecret = request.nextUrl.searchParams.get("secret")?.trim() ?? "";
  const provided = bearer || querySecret;

  if (!expected || provided !== expected) {
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
