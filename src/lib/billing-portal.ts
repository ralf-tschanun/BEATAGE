import type { Polar } from "@polar-sh/sdk";

type PortalSessionInput = {
  userId: string;
  polarCustomerId: string | null | undefined;
  returnUrl: string;
};

function normalizeReturnUrl(returnUrl: string): string {
  return decodeURI(new URL(returnUrl).toString());
}

function storedPolarCustomerId(value: string | null | undefined): string | null {
  const id = value?.trim();
  if (!id || id === "unknown") return null;
  return id;
}

/**
 * Open Polar customer portal (subscriptions, cancel, invoices).
 * Prefer the Polar customer UUID saved by webhooks; fall back to Supabase user id.
 */
export async function createCustomerPortalUrl(
  polar: Polar,
  input: PortalSessionInput,
): Promise<string> {
  const returnUrl = normalizeReturnUrl(input.returnUrl);
  const polarCustomerId = storedPolarCustomerId(input.polarCustomerId);

  const attempts: Array<
    | { kind: "customerId"; customerId: string }
    | { kind: "externalCustomerId"; externalCustomerId: string }
  > = [];

  if (polarCustomerId) {
    attempts.push({ kind: "customerId", customerId: polarCustomerId });
  }
  attempts.push({
    kind: "externalCustomerId",
    externalCustomerId: input.userId,
  });

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const session = await polar.customerSessions.create(
        attempt.kind === "customerId"
          ? { customerId: attempt.customerId, returnUrl }
          : { externalCustomerId: attempt.externalCustomerId, returnUrl },
      );
      if (session.customerPortalUrl) {
        return session.customerPortalUrl;
      }
    } catch (error) {
      lastError = error;
      console.warn("[billing-portal] customer session failed", {
        kind: attempt.kind,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw lastError ?? new Error("Polar customer portal session could not be created");
}
