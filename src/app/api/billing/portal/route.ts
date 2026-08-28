import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCustomerPortalUrl } from "@/lib/billing-portal";
import { getRequestSiteUrl } from "@/lib/site-url";
import { createPolarClient, isPolarConfigured } from "@/lib/polar";

export async function GET(request: NextRequest) {
  const siteUrl = getRequestSiteUrl(request);
  if (!isPolarConfigured()) {
    return NextResponse.redirect(`${siteUrl}/?billing=unavailable`);
  }

  const { user } = await getOptionalUser();
  if (!user || user.is_anonymous) {
    return NextResponse.redirect(
      `${siteUrl}/billing/account?next=${encodeURIComponent("/api/billing/portal")}`,
    );
  }

  let polarCustomerId: string | null = null;
  try {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("beatage_profiles")
      .select("polar_customer_id")
      .eq("id", user.id)
      .maybeSingle();
    polarCustomerId = profile?.polar_customer_id ?? null;
  } catch (error) {
    console.error("[billing/portal] profile lookup failed", error);
  }

  try {
    const polar = createPolarClient();
    const portalUrl = await createCustomerPortalUrl(polar, {
      userId: user.id,
      polarCustomerId,
      returnUrl: siteUrl,
    });
    return NextResponse.redirect(portalUrl);
  } catch (error) {
    console.error("[billing/portal] portal session failed", error);
    return NextResponse.redirect(`${siteUrl}/?billing=portal_error`);
  }
}
