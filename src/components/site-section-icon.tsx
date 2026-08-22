import type { SiteNavItemId } from "@/lib/site-nav-items";
import { SITE_NAV_ITEMS } from "@/lib/site-nav-items";
import { cn } from "@/lib/utils";

type SiteSectionIconProps = {
  id: SiteNavItemId;
  size?: "sm" | "md";
  className?: string;
};

const sizeClass = {
  sm: { box: "size-8 rounded-lg", icon: "size-4" },
  md: { box: "size-10 rounded-xl", icon: "size-5" },
} as const;

export function SiteSectionIcon({
  id,
  size = "md",
  className,
}: SiteSectionIconProps) {
  const item = SITE_NAV_ITEMS[id];
  const Icon = item.icon;
  const dims = sizeClass[size];

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        dims.box,
        item.iconClassName,
        className,
      )}
    >
      <Icon className={dims.icon} weight="duotone" />
    </span>
  );
}
