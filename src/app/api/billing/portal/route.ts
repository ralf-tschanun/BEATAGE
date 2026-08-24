import { NextRequest, NextResponse } from "next/server";
import { CustomerPortal } from "@polar-sh/nextjs";
import { getOptionalUser } from "@/lib/supabase/auth";
import { getRequestSiteUrl, getSiteUrl } from "@/lib/site-url";
import { isPolarConfigured, polarServer } from "@/lib/polar";

const portal = CustomerPortal({
  accessToken: process.env.POLAR_ACCESS_TOKEN ?? "",
  server: polarServer(),
  returnUrl: getSiteUrl(),
  getExternalCustomerId: async () => {
    const { user } = await getOptionalUser();
    if (!user || user.is_anonymous) return "";
    return user.id;
  },
});

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

  return portal(request);
}
