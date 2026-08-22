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
  }, [persist, defaultOpen]);

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
