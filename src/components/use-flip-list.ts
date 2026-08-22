"use client";

import { useLayoutEffect, useRef } from "react";

// Slow FLIP so rank changes are easy to follow (nominator + voting results).
const FLIP_DURATION_MS = 1500;
const FLIP_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/** FLIP layout animation for reordering list items (keyed by data-flip-id). */
export function useFlipList(orderKey: string) {
  const listRef = useRef<HTMLOListElement>(null);
  const positionsRef = useRef<Map<string, DOMRect>>(new Map());
  const hasMeasuredRef = useRef(false);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const items = list.querySelectorAll<HTMLElement>("[data-flip-id]");
    const nextPositions = new Map<string, DOMRect>();
    items.forEach((el) => {
      const id = el.dataset.flipId;
      if (id) nextPositions.set(id, el.getBoundingClientRect());
    });

    if (!hasMeasuredRef.current) {
      hasMeasuredRef.current = true;
      positionsRef.current = nextPositions;
      return;
    }

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!reduceMotion) {
      items.forEach((el) => {
        const id = el.dataset.flipId;
        if (!id) return;
        const oldPos = positionsRef.current.get(id);
        const newPos = nextPositions.get(id);
        if (!oldPos || !newPos) return;

        const deltaY = oldPos.top - newPos.top;
        if (Math.abs(deltaY) < 1) return;

        el.style.transform = `translateY(${deltaY}px)`;
        el.style.transition = "transform 0s";
        el.style.zIndex = "1";
        el.style.willChange = "transform";

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            el.style.transition = `transform ${FLIP_DURATION_MS}ms ${FLIP_EASING}`;
            el.style.transform = "translateY(0)";
          });
        });

        const onEnd = (event: TransitionEvent) => {
          if (event.propertyName !== "transform") return;
          el.style.transition = "";
          el.style.transform = "";
          el.style.zIndex = "";
          el.style.willChange = "";
          el.removeEventListener("transitionend", onEnd);
        };
        el.addEventListener("transitionend", onEnd);
      });
    }

    positionsRef.current = nextPositions;
  }, [orderKey]);

  return listRef;
}
