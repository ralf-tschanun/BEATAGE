"use client";

import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type ContestSectionCardProps = {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  className?: string;
  id?: string;
};

/** Non-collapsible section card (same chrome as CollapsibleCard, always open). */
export function ContestSectionCard({
  title,
  description,
  children,
  contentClassName,
  className,
  id,
}: ContestSectionCardProps) {
  return (
    <Card id={id} className={className}>
      <CardHeader className="gap-1">
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className={cn(contentClassName)}>{children}</CardContent>
    </Card>
  );
}
