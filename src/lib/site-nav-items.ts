import {
  CrownSimpleIcon,
  PlusCircleIcon,
  QuestionIcon,
  StackIcon,
  TicketIcon,
  UsersIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react/dist/lib/types";

export type SiteNavItemId =
  | "create"
  | "invite"
  | "join"
  | "hosted"
  | "joined"
  | "plan"
  | "help";

export type SiteNavItemConfig = {
  label: string;
  href?: string;
  icon: Icon;
  iconClassName: string;
};

export const SITE_NAV_ITEMS: Record<SiteNavItemId, SiteNavItemConfig> = {
  create: {
    label: "Create a quiz",
    href: "/create",
    icon: PlusCircleIcon,
    iconClassName: "bg-primary/12 text-primary",
  },
  invite: {
    label: "Invite",
    icon: UsersIcon,
    iconClassName: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
  },
  join: {
    label: "I have an invite code",
    href: "/join",
    icon: TicketIcon,
    iconClassName: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  },
  hosted: {
    label: "Quizzes you host",
    href: "/#hosted",
    icon: CrownSimpleIcon,
    iconClassName: "bg-amber-500/12 text-amber-800 dark:text-amber-300",
  },
  joined: {
    label: "Quizzes you joined",
    href: "/#joined",
    icon: UsersThreeIcon,
    iconClassName: "bg-violet-500/12 text-violet-800 dark:text-violet-300",
  },
  plan: {
    label: "Manage plan",
    icon: StackIcon,
    iconClassName: "bg-muted text-muted-foreground",
  },
  help: {
    label: "Help",
    href: "/help",
    icon: QuestionIcon,
    iconClassName: "bg-emerald-500/12 text-emerald-800 dark:text-emerald-300",
  },
};
