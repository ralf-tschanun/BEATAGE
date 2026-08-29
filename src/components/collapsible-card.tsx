"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CaretDownIcon } from "@phosphor-icons/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useCollapsibleSection } from "@/lib/collapsible-sections";
import { cn } from "@/lib/utils";

/**
 * One yellow 1px frame on the card’s own rounded edge.
 * Inset so it covers the silver hairline; ring color replaces the default
 * foreground ring (including dark:ring-foreground/10).
 */
export const ACTIVE_PANEL_CARD_CLASS =
  "shadow-none ring-1 ring-inset ring-yellow-400 dark:ring-yellow-400";

type CollapsibleCardProps = {
  /** Stable id used for global open/closed persistence (when persist). */
  sectionId: string;
  title: ReactNode;
  description?: ReactNode;
  /** Used when this section has no stored preference yet, or when not persisted. */
  defaultOpen?: boolean;
  /**
   * When false, open state is not saved — the card follows defaultOpen
   * (for phase-active sections that should start expanded).
   */
  persist?: boolean;
  /**
   * When this value changes, session-only cards reset to defaultOpen.
   * Host controls use this so a newly active panel collapses the previous one.
   */
  resetKey?: string | number | null;
  children: ReactNode;
  contentClassName?: string;
  className?: string;
  id?: string;
};

export function CollapsibleCard({
  sectionId,
  title,
  description,
  defaultOpen = true,
  persist = true,
  resetKey,
  children,
  contentClassName,
  className,
  id,
}: CollapsibleCardProps) {
  const [storedOpen, setStoredOpen] = useCollapsibleSection(
    sectionId,
    defaultOpen,
  );
  const [sessionOpen, setSessionOpen] = useState(defaultOpen);

  useEffect(() => {
    if (!persist) setSessionOpen(defaultOpen);
  }, [persist, defaultOpen, resetKey]);

  const open = persist ? storedOpen : sessionOpen;
  const setOpen = persist ? setStoredOpen : setSessionOpen;

  return (
    <Card id={id} className={className}>
      <CardHeader className="p-0">
        <button
          type="button"
          className="flex w-full items-start gap-3 px-(--card-spacing) text-left"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <CardTitle>{title}</CardTitle>
            {open && description ? (
              <CardDescription>{description}</CardDescription>
            ) : null}
          </div>
          <CaretDownIcon
            className={cn(
              "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </CardHeader>
      {open ? (
        <CardContent className={contentClassName}>{children}</CardContent>
      ) : null}
    </Card>
  );
}
