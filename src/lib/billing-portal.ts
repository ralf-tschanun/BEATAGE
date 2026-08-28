import type { Polar } from "@polar-sh/sdk";

type PortalSessionInput = {
  userId: string;
  email: string | null | undefined;
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

function isNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /Customer does not exist/i.test(message) ||
    /statusCode:\s*404/i.test(message) ||
    /statusCode:\s*422/i.test(message)
  );
}

/**
 * Resolve the Polar customer in the current environment (production/sandbox).
 * Stored IDs from the wrong environment are ignored after validation fails.
 */
export async function resolvePolarCustomerId(
  polar: Polar,
  input: {
    userId: string;
    email: string | null | undefined;
    storedPolarCustomerId: string | null | undefined;
  },
): Promise<string | null> {
  try {
    const byExternal = await polar.customers.getExternal({
      externalId: input.userId,
    });
    if (byExternal.id) return byExternal.id;
  } catch (error) {
    if (!isNotFoundError(error)) {
      console.warn("[billing-portal] getExternal failed", error);
    }
  }

  const email = input.email?.trim();
  if (email) {
    try {
      const pages = await polar.customers.list({ email, limit: 1 });
      for await (const page of pages) {
        const customer = page.result.items[0];
        if (customer?.id) return customer.id;
        break;
      }
    } catch (error) {
      console.warn("[billing-portal] list by email failed", error);
    }
  }

  const stored = storedPolarCustomerId(input.storedPolarCustomerId);
  if (stored) {
    try {
      const customer = await polar.customers.get({ id: stored });
      if (customer.id) return customer.id;
    } catch (error) {
      console.warn("[billing-portal] stored polar_customer_id invalid in current Polar env", {
        stored,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return null;
}

/**
 * Open Polar customer portal (subscriptions, cancel, invoices).
 */
export async function createCustomerPortalUrl(
  polar: Polar,
  input: PortalSessionInput,
): Promise<string> {
  const returnUrl = normalizeReturnUrl(input.returnUrl);
  const customerId = await resolvePolarCustomerId(polar, {
    userId: input.userId,
    email: input.email,
    storedPolarCustomerId: input.polarCustomerId,
  });

  if (!customerId) {
    throw new Error("Polar customer not found for this account");
  }

  const session = await polar.customerSessions.create({
    customerId,
    returnUrl,
  });

  if (!session.customerPortalUrl) {
    throw new Error("Polar customer portal URL missing");
  }

  return session.customerPortalUrl;
}
