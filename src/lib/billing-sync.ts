import { planFromProductIds, skuFromProductId } from "@/lib/polar";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlanId } from "@/lib/plans";

type PolarCustomerState = {
  id: string;
  externalId?: string | null;
  activeSubscriptions: Array<{ productId: string }>;
};

type PolarOrder = {
  productId?: string | null;
  product?: { id?: string | null } | null;
  metadata?: Record<string, unknown> | null;
  customer: { externalId?: string | null };
};

function userIdFromExternal(value: string | null | undefined): string | null {
  const id = value?.trim();
  if (!id) return null;
  return id;
}

export async function syncPlanFromCustomerState(state: PolarCustomerState) {
  const userId = userIdFromExternal(state.externalId);
  if (!userId) return;

  const productIds = state.activeSubscriptions.map((sub) => sub.productId);
  const plan: PlanId = planFromProductIds(productIds);
  const admin = createAdminClient();
  const { error } = await admin.rpc("beatage_apply_billing_plan", {
    p_user_id: userId,
    p_plan: plan,
    p_polar_customer_id: state.id,
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function unlockQuizFromOrder(order: PolarOrder) {
  const productId = order.productId ?? order.product?.id ?? null;
  if (skuFromProductId(productId) !== "quiz_unlock") return;

  const quizId = String(order.metadata?.quiz_id ?? "").trim();
  const userId = userIdFromExternal(order.customer.externalId);
  if (!quizId || !userId) return;

  const admin = createAdminClient();
  const { error } = await admin.rpc("beatage_unlock_quiz_from_billing", {
    p_quiz_id: quizId,
    p_user_id: userId,
  });
  if (error) {
    throw new Error(error.message);
  }
}
