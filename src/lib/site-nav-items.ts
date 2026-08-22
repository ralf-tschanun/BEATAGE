import {
  CrownSimpleIcon,
  PlusCircleIcon,
  StackIcon,
  TicketIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react/dist/lib/types";

export type SiteNavItemId = "create" | "join" | "hosted" | "joined" | "plan";

export type SiteNavItemConfig = {
  label: string;
  href?: string;
  icon: Icon;
  iconClassName: string;
};

export const SITE_NAV_ITEMS: Record<SiteNavItemId, SiteNavItemConfig> = {
  create: {
    label: "Create a contest",
    href: "/create",
    icon: PlusCircleIcon,
    iconClassName: "bg-primary/12 text-primary",
  },
  join: {
    label: "I have an invite code",
    href: "/join",
    icon: TicketIcon,
    iconClassName: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  },
  hosted: {
    label: "Contests you host",
    href: "/#hosted",
    icon: CrownSimpleIcon,
    iconClassName: "bg-amber-500/12 text-amber-800 dark:text-amber-300",
  },
  joined: {
    label: "Contests you joined",
    href: "/#joined",
    icon: UsersThreeIcon,
    iconClassName: "bg-violet-500/12 text-violet-800 dark:text-violet-300",
  },
  plan: {
    label: "Manage plan",
    icon: StackIcon,
    iconClassName: "bg-muted text-muted-foreground",
  },
};
