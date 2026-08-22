import Link from "next/link";
import { MusicNotesIcon } from "@phosphor-icons/react/dist/ssr";
import { SiteNavDrawer } from "@/components/site-nav-drawer";
import type { DashboardIdentity } from "@/lib/contests/dashboard";
import type { PlanId } from "@/lib/plans";
import { cn } from "@/lib/utils";

type SiteHeaderProps = {
  identity: DashboardIdentity | null;
  currentPlan: PlanId;
  unlockContest?: { id: string; unlocked: boolean } | null;
};

export function SiteHeader({
  identity,
  currentPlan,
  unlockContest = null,
}: SiteHeaderProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b border-border/60",
        "bg-background/85 backdrop-blur-sm supports-[backdrop-filter]:bg-background/70",
      )}
    >
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-3">
        <Link
          href="/"
          className="inline-flex items-center gap-2 font-semibold tracking-tight transition-opacity hover:opacity-80"
        >
          <span className="inline-flex size-8 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <MusicNotesIcon className="size-4" weight="fill" />
          </span>
          BEATAGE
        </Link>
        <SiteNavDrawer
          identity={identity}
          currentPlan={currentPlan}
          unlockContest={unlockContest}
        />
      </div>
    </header>
  );
}
