import { type BillingInterval } from "@/lib/billing-copy";
import {
  billingIntervalForPlan,
  createPolarClient,
  isPolarConfigured,
} from "@/lib/polar";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOptionalUser } from "@/lib/supabase/auth";
import type { PlanId } from "@/lib/quiz-plans";

function parsePlan(value: unknown): PlanId {
  return value === "plus" || value === "pro" ? value : "free";
}

function parseInterval(value: unknown): BillingInterval | null {
  return value === "monthly" || value === "yearly" ? value : null;
}

async function resolveIntervalFromPolar(
  userId: string,
  plan: PlanId,
): Promise<BillingInterval | null> {
  if (plan !== "plus" && plan !== "pro") return null;
  if (!isPolarConfigured()) return null;

  try {
    const polar = createPolarClient();
    const state = await polar.customers.getStateExternal({ externalId: userId });
    const subs = state.activeSubscriptions ?? [];
    const productIds = subs
      .map((sub) => sub.productId)
      .filter((id): id is string => Boolean(id));
    const mapped = billingIntervalForPlan(productIds, plan);
    if (mapped) return mapped;

    // Product env ids can lag a rename. One active subscription is this plan.
    if (subs.length === 1) {
      if (subs[0]?.recurringInterval === "month") return "monthly";
      if (subs[0]?.recurringInterval === "year") return "yearly";
    }
    return null;
  } catch (error) {
    console.warn("[billing-interval] Polar lookup failed", error);
    return null;
  }
}

async function storeBillingInterval(userId: string, interval: BillingInterval) {
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("beatage_profiles")
      .update({
        billing_interval: interval,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
    if (error) {
      console.warn("[billing-interval] could not store interval", error.message);
    }
  } catch (error) {
    console.warn("[billing-interval] could not store interval", error);
  }
}

/**
 * Monthly vs yearly for the signed-in paid plan.
 * Reads beatage_profiles.billing_interval, and fills it from Polar when missing
 * (accounts subscribed before the column existed).
 */
export async function loadCurrentBillingInterval(): Promise<BillingInterval | null> {
  const { supabase, user } = await getOptionalUser();
  if (!user || user.is_anonymous) return null;

  const { data, error } = await supabase
    .from("beatage_profiles")
    .select("plan, billing_interval")
    .eq("id", user.id)
    .maybeSingle();

  if (!error && data) {
    const plan = parsePlan(data.plan);
    if (plan !== "plus" && plan !== "pro") return null;
    const stored = parseInterval(data.billing_interval);
    if (stored) return stored;
    const resolved = await resolveIntervalFromPolar(user.id, plan);
    if (!resolved) return null;
    await storeBillingInterval(user.id, resolved);
    return resolved;
  }

  // billing_interval may not be migrated yet. Plan still lives on the same row.
  const { data: planRow, error: planError } = await supabase
    .from("beatage_profiles")
    .select("plan")
    .eq("id", user.id)
    .maybeSingle();
  if (planError || !planRow) return null;

  const plan = parsePlan(planRow.plan);
  if (plan !== "plus" && plan !== "pro") return null;
  const resolved = await resolveIntervalFromPolar(user.id, plan);
  if (!resolved) return null;
  await storeBillingInterval(user.id, resolved);
  return resolved;
}
