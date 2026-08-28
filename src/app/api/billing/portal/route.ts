import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createCustomerPortalUrl,
  resolvePolarCustomerId,
} from "@/lib/billing-portal";
import { getRequestSiteUrl } from "@/lib/site-url";
import { createPolarClient, isPolarConfigured } from "@/lib/polar";

async function persistPolarCustomerId(userId: string, polarCustomerId: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("beatage_profiles")
    .update({ polar_customer_id: polarCustomerId })
    .eq("id", userId);
  if (error) {
    console.warn("[billing/portal] could not persist polar_customer_id", error);
  }
}

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

  const customerEmail =
    user.email?.trim() ||
    (typeof user.new_email === "string" ? user.new_email.trim() : "") ||
    null;

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
    const resolvedCustomerId = await resolvePolarCustomerId(polar, {
      userId: user.id,
      email: customerEmail,
      storedPolarCustomerId: polarCustomerId,
    });
    if (
      resolvedCustomerId &&
      resolvedCustomerId !== polarCustomerId?.trim()
    ) {
      await persistPolarCustomerId(user.id, resolvedCustomerId);
    }

    const portalUrl = await createCustomerPortalUrl(polar, {
      userId: user.id,
      email: customerEmail,
      polarCustomerId: resolvedCustomerId ?? polarCustomerId,
      returnUrl: siteUrl,
    });
    return NextResponse.redirect(portalUrl);
  } catch (error) {
    console.error("[billing/portal] portal session failed", error);
    return NextResponse.redirect(`${siteUrl}/?billing=portal_error`);
  }
}
