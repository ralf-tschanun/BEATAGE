"use client";

import { useEffect, useState } from "react";

const FLASH_KEYS = ["removed", "deleted", "left"] as const;

type HomeStatusBannerProps = {
  removed?: string;
  deleted?: string;
  left?: string;
};

function flashMessage(opts: HomeStatusBannerProps): string | null {
  if (opts.deleted === "1") return "Quiz deleted.";
  if (opts.left === "1") return "You left the quiz.";
  if (opts.removed === "1") return "That quiz is no longer available.";
  return null;
}

/**
 * One-shot home flashes from ?deleted / ?left / ?removed.
 * Strip those params from the URL so the banner does not stick until the
 * next navigation (refresh / logo click / opening another quiz).
 */
export function HomeStatusBanner({
  removed,
  deleted,
  left,
}: HomeStatusBannerProps) {
  const [message] = useState(() => flashMessage({ removed, deleted, left }));

  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of FLASH_KEYS) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (!changed) return;
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, "", next);
  }, []);

  if (!message) return null;

  return (
    <p className="mx-auto w-full max-w-5xl px-6 pt-4 text-sm text-foreground">
      {message}
    </p>
  );
}
