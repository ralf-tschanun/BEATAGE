import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/supabase/auth";
import { getRequestSiteUrl } from "@/lib/site-url";
import {
  createPolarClient,
  isPolarConfigured,
  parseBillingSku,
  productIdForSku,
} from "@/lib/polar";

function accountGateUrl(siteUrl: string, continuePath: string): string {
  return `${siteUrl}/billing/account?next=${encodeURIComponent(continuePath)}`;
}

export async function GET(request: NextRequest) {
  const siteUrl = getRequestSiteUrl(request);
  if (!isPolarConfigured()) {
    return NextResponse.redirect(`${siteUrl}/?billing=unavailable`);
  }

  const continuePath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const { supabase, user } = await getOptionalUser();

  // Polar checkout needs a real email account. Guests create/sign in first, then
  // continue here (same user id after guest conversion keeps unlock ownership).
  if (!user || user.is_anonymous) {
    return NextResponse.redirect(accountGateUrl(siteUrl, continuePath));
  }

  const sku = parseBillingSku(request.nextUrl.searchParams.get("sku"));
  if (!sku) {
    return NextResponse.redirect(`${siteUrl}/?billing=invalid`);
  }

  const productId = productIdForSku(sku);
  if (!productId) {
    return NextResponse.redirect(`${siteUrl}/?billing=unavailable`);
  }

  const quizId =
    request.nextUrl.searchParams.get("quizId")?.trim() ??
    request.nextUrl.searchParams.get("contestId")?.trim() ??
    "";
  let unlockJoinCode = "";
  if (sku === "quiz_unlock") {
    if (!quizId) {
      return NextResponse.redirect(`${siteUrl}/?billing=invalid`);
    }
    const { data: quiz } = await supabase
      .from("beatage_quizzes")
      .select("id, host_user_id, join_code, unlocked_at")
      .eq("id", quizId)
      .maybeSingle();
    if (!quiz || quiz.host_user_id !== user.id) {
      return NextResponse.redirect(`${siteUrl}/?billing=invalid`);
    }
    if (quiz.unlocked_at) {
      return NextResponse.redirect(`${siteUrl}/q/${quiz.join_code}`);
    }
    unlockJoinCode = quiz.join_code;
  }

  const polar = createPolarClient();
  const successUrl =
    sku === "quiz_unlock" && unlockJoinCode
      ? `${siteUrl}/q/${encodeURIComponent(unlockJoinCode)}?billing=unlocked`
      : `${siteUrl}/?billing=success`;

  const customerEmail =
    user.email?.trim() ||
    (typeof user.new_email === "string" ? user.new_email.trim() : "") ||
    undefined;

  try {
    const checkout = await polar.checkouts.create({
      products: [productId],
      successUrl,
      returnUrl: siteUrl,
      externalCustomerId: user.id,
      customerEmail,
      metadata: {
        supabase_user_id: user.id,
        sku,
        ...(sku === "quiz_unlock" ? { quiz_id: quizId } : {}),
      },
    });

    if (!checkout.url) {
      return NextResponse.redirect(`${siteUrl}/?billing=unavailable`);
    }

    return NextResponse.redirect(checkout.url);
  } catch (error) {
    console.error("[billing/checkout] Polar checkout failed", error);
    return NextResponse.redirect(`${siteUrl}/?billing=error`);
  }
}
