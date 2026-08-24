"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

const ACTION_WIDTH = 88;

type SwipeToRemoveRowProps = {
  enabled: boolean;
  onRequestRemove: () => void;
  children: ReactNode;
  highlighted?: boolean;
  /** Hover highlight + pointer cursor (e.g. host inspecting a row). */
  interactive?: boolean;
  /** Fired on a plain click (not after a swipe gesture). */
  onRowClick?: () => void;
  /** Label on the revealed action (e.g. Remove, Delete, Leave). */
  actionLabel?: string;
  /** Render inside a shared card/list without its own border chrome. */
  embedded?: boolean;
  /** Padding / surface classes on the row content (default: px-3 py-2). */
  contentClassName?: string;
};

/**
 * Swipe left to reveal a destructive action. Calls onRequestRemove when
 * the swipe threshold is met or the action button is tapped.
 * Pointer capture starts only after a horizontal swipe is confirmed so
 * nested links / buttons still receive normal taps.
 */
export function SwipeToRemoveRow({
  enabled,
  onRequestRemove,
  children,
  highlighted = false,
  interactive = false,
  onRowClick,
  actionLabel = "Remove",
  embedded = false,
  contentClassName = "px-3 py-2",
}: SwipeToRemoveRowProps) {
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const startOffset = useRef(0);
  const axis = useRef<"x" | "y" | null>(null);
  const dragging = useRef(false);
  const capturing = useRef(false);
  const suppressClick = useRef(false);

  const rowSurfaceClass = [
    highlighted ? "bg-muted" : embedded ? "bg-card" : "bg-background",
    interactive
      ? "cursor-pointer transition-colors hover:bg-muted"
      : "",
    contentClassName,
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  useEffect(() => {
    if (!enabled) setOffset(0);
  }, [enabled]);

  function clamp(value: number) {
    return Math.min(0, Math.max(-ACTION_WIDTH, value));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!enabled) return;
    // Primary button / touch only — ignore right-click etc.
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragging.current = true;
    capturing.current = false;
    axis.current = null;
    suppressClick.current = false;
    startX.current = event.clientX;
    startY.current = event.clientY;
    startOffset.current = offsetRef.current;
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!enabled || !dragging.current) return;
    const dx = event.clientX - startX.current;
    const dy = event.clientY - startY.current;
    if (!axis.current) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      axis.current = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
    }
    if (axis.current !== "x") return;
    if (!capturing.current) {
      event.currentTarget.setPointerCapture(event.pointerId);
      capturing.current = true;
    }
    event.preventDefault();
    suppressClick.current = true;
    setOffset(clamp(startOffset.current + dx));
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!enabled || !dragging.current) return;
    dragging.current = false;
    if (capturing.current) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      capturing.current = false;
    }
    if (axis.current !== "x") {
      axis.current = null;
      return;
    }
    axis.current = null;
    const next = offsetRef.current;
    if (next <= -ACTION_WIDTH * 0.55) {
      setOffset(-ACTION_WIDTH);
      onRequestRemove();
      // Snap closed after opening confirm so the row stays readable.
      window.setTimeout(() => setOffset(0), 180);
    } else {
      setOffset(0);
    }
  }

  function onClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    if (suppressClick.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressClick.current = false;
      return;
    }
    if (onRowClick) {
      event.preventDefault();
      onRowClick();
    }
  }

  const Wrapper = embedded ? "div" : "li";

  if (!enabled) {
    return (
      <Wrapper
        className={
          embedded
            ? rowSurfaceClass
            : `rounded-lg border ${rowSurfaceClass} ${
                highlighted ? "border-muted-foreground/20" : ""
              }`
        }
        onClick={
          onRowClick
            ? (event) => {
                event.preventDefault();
                onRowClick();
              }
            : undefined
        }
        role={onRowClick ? "button" : undefined}
        tabIndex={onRowClick ? 0 : undefined}
        onKeyDown={
          onRowClick
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onRowClick();
                }
              }
            : undefined
        }
      >
        {children}
      </Wrapper>
    );
  }

  return (
    <Wrapper
      className={embedded ? "relative overflow-hidden" : "relative overflow-hidden rounded-lg border"}
    >
      <div className="absolute inset-y-0 right-0 flex w-[88px] items-stretch justify-end bg-destructive">
        <button
          type="button"
          className="flex w-full items-center justify-center px-2 text-xs font-medium text-destructive-foreground"
          onClick={() => {
            setOffset(0);
            onRequestRemove();
          }}
        >
          {actionLabel}
        </button>
      </div>
      <div
        className={`relative touch-pan-y transition-transform ${rowSurfaceClass}`}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        role={onRowClick ? "button" : undefined}
        tabIndex={onRowClick ? 0 : undefined}
        onKeyDown={
          onRowClick
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onRowClick();
                }
              }
            : undefined
        }
      >
        {children}
      </div>
    </Wrapper>
  );
}
