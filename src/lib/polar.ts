import { Polar } from "@polar-sh/sdk";
import type { PlanId } from "@/lib/plans";
import type { BillingSku } from "@/lib/billing-copy";

export type { BillingSku };

const PRODUCT_ENV: Record<BillingSku, string> = {
  plus_monthly: "POLAR_PRODUCT_PLUS_MONTHLY",
  plus_yearly: "POLAR_PRODUCT_PLUS_YEARLY",
  pro_monthly: "POLAR_PRODUCT_PRO_MONTHLY",
  pro_yearly: "POLAR_PRODUCT_PRO_YEARLY",
  quiz_unlock: "POLAR_PRODUCT_QUIZ_UNLOCK",
};

export function polarServer(): "sandbox" | "production" {
  return process.env.POLAR_SERVER === "production" ? "production" : "sandbox";
}

export function isPolarConfigured(): boolean {
  return Boolean(process.env.POLAR_ACCESS_TOKEN?.trim());
}

export function createPolarClient() {
  const accessToken = process.env.POLAR_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    throw new Error("POLAR_ACCESS_TOKEN is not set");
  }
  return new Polar({ accessToken, server: polarServer() });
}

export function parseBillingSku(value: string | null): BillingSku | null {
  if (
    value === "plus_monthly" ||
    value === "plus_yearly" ||
    value === "pro_monthly" ||
    value === "pro_yearly" ||
    value === "quiz_unlock"
  ) {
    return value;
  }
  return null;
}

export function productIdForSku(sku: BillingSku): string | null {
  const id = process.env[PRODUCT_ENV[sku]]?.trim();
  return id || null;
}

export function skuFromProductId(productId: string | null | undefined): BillingSku | null {
  if (!productId) return null;
  for (const sku of Object.keys(PRODUCT_ENV) as BillingSku[]) {
    if (process.env[PRODUCT_ENV[sku]]?.trim() === productId) return sku;
  }
  return null;
}

export function planFromSku(sku: BillingSku): PlanId | null {
  if (sku === "plus_monthly" || sku === "plus_yearly") return "plus";
  if (sku === "pro_monthly" || sku === "pro_yearly") return "pro";
  return null;
}

export function planFromProductIds(productIds: string[]): PlanId {
  let plan: PlanId = "free";
  for (const productId of productIds) {
    const sku = skuFromProductId(productId);
    if (!sku) continue;
    const next = planFromSku(sku);
    if (next === "pro") return "pro";
    if (next === "plus") plan = "plus";
  }
  return plan;
}
