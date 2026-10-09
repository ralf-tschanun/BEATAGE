"use server";

import { loadCurrentBillingInterval as loadInterval } from "@/lib/billing-interval";
import type { BillingInterval } from "@/lib/billing-copy";

/** Cadence of the signed-in Plus or Pro subscription, if one is active. */
export async function loadCurrentBillingInterval(): Promise<BillingInterval | null> {
  return loadInterval();
}
