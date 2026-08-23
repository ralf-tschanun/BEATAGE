import type { DashboardIdentity } from "@/lib/contests/dashboard";

type SessionIdentityProps = {
  identity: DashboardIdentity | null;
};

export function SessionIdentity({ identity }: SessionIdentityProps) {
  if (!identity) {
    return (
      <div className="rounded-lg border px-3 py-3 text-sm text-muted-foreground">
        No session on this device yet. Create or join a quiz to get a guest identity.
      </div>
    );
  }

  return (
    <div className="rounded-lg border px-3 py-3 text-sm">
      <p className="font-medium text-foreground">
        Signed in as {identity.displayName?.trim() || "Guest"}
        {identity.isAnonymous ? (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            (guest session)
          </span>
        ) : null}
      </p>
      <p className="mt-1 text-muted-foreground">
        Unique ID:{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground break-all">
          {identity.userId}
        </code>
      </p>
    </div>
  );
}
