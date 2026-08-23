"use server";

import { revalidatePath } from "next/cache";
import { ensureAnonymousSession } from "@/lib/supabase/auth";
import type { PlanId } from "@/lib/plans";

export type PlanActionState = {
  error?: string;
  success?: string;
} | null;

function mapPlanError(message: string): string {
  if (message.includes("INVALID_PASSWORD")) {
    return "Incorrect password for the selected plan.";
  }
  if (message.includes("INVALID_PLAN")) {
    return "Please select a valid plan.";
  }
  if (message.includes("NOT_AUTHENTICATED") || message.toLowerCase().includes("auth session")) {
    return "Create or join a quiz first to establish a session, then manage plan.";
  }
  if (message.includes("Anonymous sign-in")) {
    return message;
  }
  return message || "Something went wrong.";
}

export async function changePlanAction(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const plan = String(formData.get("plan") ?? "").trim().toLowerCase() as PlanId;
  const password = String(formData.get("password") ?? "");

  if (!["free", "plus", "pro"].includes(plan)) {
    return { error: "Please select a valid plan." };
  }

  if (plan === "plus" && password !== "Plus") {
    return { error: "Incorrect password for the selected plan." };
  }

  if (plan === "pro" && password !== "Pro") {
    return { error: "Incorrect password for the selected plan." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();
    const { error } = await supabase.rpc("change_plan", {
      p_plan: plan,
      p_password: plan === "free" ? "" : password,
    });

    if (error) {
      return { error: mapPlanError(error.message) };
    }

    revalidatePath("/");
    return { success: `Plan updated to ${plan}.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapPlanError(message) };
  }
}
