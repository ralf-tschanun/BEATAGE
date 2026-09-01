"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type FadeMountProps = {
  show: boolean;
  children: ReactNode;
  durationMs?: number;
  className?: string;
};

/**
 * Keep children mounted through a fade/slide so stage cards appear and leave
 * gradually instead of popping in and out.
 */
export function FadeMount({
  show,
  children,
  durationMs = 500,
  className,
}: FadeMountProps) {
  const [mounted, setMounted] = useState(show);
  const [open, setOpen] = useState(false);
  const heldRef = useRef(children);
  if (show) heldRef.current = children;

  useEffect(() => {
    if (show) {
      setMounted(true);
      let inner = 0;
      const outer = window.requestAnimationFrame(() => {
        inner = window.requestAnimationFrame(() => setOpen(true));
      });
      return () => {
        window.cancelAnimationFrame(outer);
        window.cancelAnimationFrame(inner);
      };
    }
    setOpen(false);
    const timeout = window.setTimeout(() => setMounted(false), durationMs);
    return () => window.clearTimeout(timeout);
  }, [show, durationMs]);

  if (!mounted) return null;

  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity,transform] ease-out motion-reduce:transition-none",
        open
          ? "grid-rows-[1fr] translate-y-0 opacity-100"
          : "grid-rows-[0fr] translate-y-1 opacity-0",
        !open && "pointer-events-none",
        className,
      )}
      style={{ transitionDuration: `${durationMs}ms` }}
      aria-hidden={!open}
    >
      <div className="min-h-0 overflow-hidden">{heldRef.current}</div>
    </div>
  );
}
