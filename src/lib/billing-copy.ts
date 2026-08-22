export type BillingSku =
  | "plus_monthly"
  | "plus_yearly"
  | "pro_monthly"
  | "pro_yearly"
  | "quiz_unlock";

export const BILLING_SKU_LABELS: Record<BillingSku, string> = {
  plus_monthly: "€2.99 / month",
  plus_yearly: "€20 / year",
  pro_monthly: "€6.99 / month",
  pro_yearly: "€50 / year",
  quiz_unlock: "€4.99 once",
};
