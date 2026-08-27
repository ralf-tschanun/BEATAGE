import { planFromProductIds, planFromSku, skuFromProductId } from "@/lib/polar";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlanId } from "@/lib/plans";

type PolarCustomerState = {
  id: string;
  externalId?: string | null;
  external_id?: string | null;
  activeSubscriptions?: Array<{ productId?: string; product_id?: string }>;
  active_subscriptions?: Array<{ productId?: string; product_id?: string }>;
};

type PolarOrder = {
  productId?: string | null;
  product_id?: string | null;
  product?: { id?: string | null } | null;
  metadata?: Record<string, unknown> | null;
  customer?: {
    id?: string | null;
    externalId?: string | null;
    external_id?: string | null;
  } | null;
};

function userIdFromExternal(value: string | null | undefined): string | null {
  const id = value?.trim();
  if (!id) return null;
  return id;
}

function externalIdFromCustomer(customer: {
  externalId?: string | null;
  external_id?: string | null;
}): string | null {
  return userIdFromExternal(customer.externalId ?? customer.external_id);
}

function productIdsFromCustomerState(state: PolarCustomerState): string[] {
  const rows =
    state.activeSubscriptions ?? state.active_subscriptions ?? [];
  return rows
    .map((sub) => (sub.productId ?? sub.product_id ?? "").trim())
    .filter(Boolean);
}

async function applyPlan(opts: {
  userId: string;
  plan: PlanId;
  polarCustomerId: string;
  source: string;
}) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("beatage_apply_billing_plan", {
    p_user_id: opts.userId,
    p_plan: opts.plan,
    p_polar_customer_id: opts.polarCustomerId,
  });
  if (error) {
    throw new Error(error.message);
  }
  console.info("[billing-sync] plan applied", {
    source: opts.source,
    userId: opts.userId,
    plan: opts.plan,
    polarCustomerId: opts.polarCustomerId,
  });
}

export async function syncPlanFromCustomerState(state: PolarCustomerState) {
  const userId = externalIdFromCustomer(state);
  if (!userId) {
    console.warn(
      "[billing-sync] customer.state_changed ignored: missing external_id",
      { polarCustomerId: state.id },
    );
    return;
  }

  const productIds = productIdsFromCustomerState(state);
  const plan: PlanId = planFromProductIds(productIds);
  if (plan === "free" && productIds.length > 0) {
    console.warn(
      "[billing-sync] subscriptions present but no matching POLAR_PRODUCT_* env ids",
      { userId, productIds },
    );
  }

  await applyPlan({
    userId,
    plan,
    polarCustomerId: state.id,
    source: "customer.state_changed",
  });
}

export async function unlockQuizFromOrder(order: PolarOrder) {
  const productId =
    order.productId ?? order.product_id ?? order.product?.id ?? null;
  const sku = skuFromProductId(productId);
  const userId = externalIdFromCustomer(order.customer ?? {});
  const polarCustomerId = order.customer?.id?.trim() || "";

  // Subscriptions: also apply plan from order.paid (resends are often this event).
  if (sku === "plus_monthly" || sku === "plus_yearly" || sku === "pro_monthly" || sku === "pro_yearly") {
    if (!userId) {
      console.warn(
        "[billing-sync] order.paid plan sync ignored: missing customer.external_id",
        { productId, sku },
      );
      return;
    }
    const plan = planFromSku(sku);
    if (!plan) return;
    await applyPlan({
      userId,
      plan,
      polarCustomerId: polarCustomerId || "unknown",
      source: "order.paid",
    });
    return;
  }

  if (sku !== "quiz_unlock") {
    console.warn("[billing-sync] order.paid ignored: unknown product", {
      productId,
    });
    return;
  }

  const quizId = String(order.metadata?.quiz_id ?? "").trim();
  if (!quizId || !userId) {
    console.warn(
      "[billing-sync] quiz unlock ignored: missing quiz_id or external_id",
      { quizId: quizId || null, hasUserId: Boolean(userId), productId },
    );
    return;
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("beatage_unlock_quiz_from_billing", {
    p_quiz_id: quizId,
    p_user_id: userId,
  });
  if (error) {
    throw new Error(error.message);
  }
  console.info("[billing-sync] quiz unlocked", { quizId, userId });
}
