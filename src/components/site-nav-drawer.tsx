"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { CaretRightIcon, ListIcon, TrophyIcon, UserCircleIcon } from "@phosphor-icons/react";
import { ChangePlanForm } from "@/components/change-plan-form";
import { AccountAuthForm } from "@/components/account-auth-form";
import { SiteSectionIcon } from "@/components/site-section-icon";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { DashboardIdentity } from "@/lib/quizzes/dashboard";
import { QUIZ_PLANS, type PlanId } from "@/lib/quiz-plans";
import { BRAND_NAME } from "@/lib/brand";
import { SITE_NAV_ITEMS, type SiteNavItemId } from "@/lib/site-nav-items";
import { cn } from "@/lib/utils";

type SiteNavDrawerProps = {
  identity: DashboardIdentity | null;
  currentPlan: PlanId;
  unlockContest?: { id: string; unlocked: boolean } | null;
};

type NavLinkItem = {
  kind: "link";
  id: SiteNavItemId;
};

type NavActionItem = {
  kind: "action";
  id: "plan";
  onSelect: () => void;
  trailing?: ReactNode;
};

type NavItem = NavLinkItem | NavActionItem;

const primaryItems: NavLinkItem[] = [
  { kind: "link", id: "create" },
  { kind: "link", id: "join" },
];

const dashboardItems: NavLinkItem[] = [
  { kind: "link", id: "hosted" },
  { kind: "link", id: "joined" },
];

function NavSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      {children}
    </div>
  );
}

function NavRow({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const config = SITE_NAV_ITEMS[item.id];
  const rowClassName = cn(
    "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors",
    "hover:bg-muted/70 active:bg-muted",
  );
  const content = (
    <>
      <SiteSectionIcon id={item.id} />
      <span className="min-w-0 flex-1 text-left text-sm font-medium">{config.label}</span>
      {item.kind === "action" && item.trailing ? (
        item.trailing
      ) : (
        <CaretRightIcon
          className="size-4 shrink-0 text-muted-foreground/50"
          aria-hidden
        />
      )}
    </>
  );

  if (item.kind === "link") {
    return (
      <Link href={config.href ?? "/"} onClick={onNavigate} className={rowClassName}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={item.onSelect} className={rowClassName}>
      {content}
    </button>
  );
}

function accountInitials(identity: DashboardIdentity): string {
  const name = identity.displayName?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  const email = identity.email?.trim();
  if (email) return email[0]?.toUpperCase() ?? "A";
  return "A";
}

function accountLabel(identity: DashboardIdentity): string {
  return (
    identity.displayName?.trim() ||
    identity.email?.split("@")[0] ||
    "Account"
  );
}

export function SiteNavDrawer({
  identity,
  currentPlan,
  unlockContest = null,
}: SiteNavDrawerProps) {
  const [open, setOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const planLabel = QUIZ_PLANS[currentPlan]?.label ?? "Free";

  const settingsItem: NavActionItem = {
    kind: "action",
    id: "plan",
    onSelect: () => {
      setOpen(false);
      setPlanOpen(true);
    },
    trailing: (
      <span className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {planLabel}
      </span>
    ),
  };

  function closeDrawer() {
    setOpen(false);
  }

  const signedIn = Boolean(identity && !identity.isAnonymous);

  return (
    <>
      <div className="flex items-center gap-1">
        {signedIn && identity ? (
          <Button
            type="button"
            variant="ghost"
            size="default"
            className="h-9 max-w-[16rem] gap-2 rounded-2xl px-1.5 pr-2.5"
            onClick={() => setOpen(true)}
            aria-label={`Account, signed in as ${accountLabel(identity)}`}
          >
            <span
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold tracking-wide text-primary ring-1 ring-primary/25"
              aria-hidden
            >
              {accountInitials(identity)}
            </span>
            <span className="min-w-0 truncate text-sm font-medium">
              {accountLabel(identity)}
            </span>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-2xl"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
        >
          <ListIcon className="size-5" weight="bold" />
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b px-6 pb-5">
            <div className="flex items-center gap-3 pr-8">
              <span className="inline-flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <TrophyIcon className="size-5" weight="fill" />
              </span>
              <div className="min-w-0 text-left">
                <SheetTitle>Menu</SheetTitle>
                <SheetDescription>Navigate {BRAND_NAME}</SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
            <NavSection title="Get started">
              {primaryItems.map((item) => (
                <NavRow key={item.id} item={item} onNavigate={closeDrawer} />
              ))}
            </NavSection>

            <NavSection title="Your quizzes">
              {dashboardItems.map((item) => (
                <NavRow key={item.id} item={item} onNavigate={closeDrawer} />
              ))}
            </NavSection>

            <NavSection title="Settings">
              <NavRow item={settingsItem} onNavigate={closeDrawer} />
            </NavSection>

            <NavSection title="Support">
              <NavRow item={{ kind: "link", id: "help" }} onNavigate={closeDrawer} />
            </NavSection>
          </nav>

          <div className="mt-auto border-t bg-muted/20 px-6 py-5">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Account
            </p>
            <div className="mt-3 flex items-start gap-3">
              <span
                className={cn(
                  "inline-flex size-10 shrink-0 items-center justify-center rounded-full ring-1",
                  signedIn
                    ? "bg-primary/15 text-primary ring-primary/25"
                    : "bg-background text-muted-foreground ring-border",
                )}
              >
                {signedIn && identity ? (
                  <span className="text-sm font-semibold" aria-hidden>
                    {accountInitials(identity)}
                  </span>
                ) : (
                  <UserCircleIcon className="size-6" weight="duotone" />
                )}
              </span>
              <div className="min-w-0 flex-1 space-y-3">
                {identity ? (
                  <p className="text-sm font-medium leading-snug">
                    {identity.displayName?.trim() ||
                      (identity.isAnonymous ? "Guest" : identity.email) ||
                      "Signed in"}
                    {identity.isAnonymous ? (
                      <span className="ml-1 font-normal text-muted-foreground">
                        (guest)
                      </span>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    No session yet. Create a quiz or sign in with email.
                  </p>
                )}
                <AccountAuthForm
                  hasSession={Boolean(identity)}
                  isAnonymous={Boolean(identity?.isAnonymous)}
                  email={identity?.email}
                  displayName={identity?.displayName}
                />
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ChangePlanForm
        currentPlan={currentPlan}
        hasSession={Boolean(identity)}
        isAnonymous={Boolean(identity?.isAnonymous)}
        open={planOpen}
        onOpenChange={setPlanOpen}
        showTrigger={false}
        unlockContest={unlockContest}
      />
    </>
  );
}
