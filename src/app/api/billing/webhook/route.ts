import { Webhooks } from "@polar-sh/nextjs";
import {
  syncPlanFromCustomerState,
  unlockQuizFromOrder,
} from "@/lib/billing-sync";

export const POST = Webhooks({
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET ?? "",
  onCustomerStateChanged: async (payload) => {
    await syncPlanFromCustomerState(payload.data);
  },
  onOrderPaid: async (payload) => {
    await unlockQuizFromOrder(payload.data);
  },
});
