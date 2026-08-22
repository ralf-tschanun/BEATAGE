"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Human-readable remaining time until `closesAt` (ISO / Date). */
export function formatRemainingUntil(closesAt: string | Date, nowMs = Date.now()): string {
  const end = typeof closesAt === "string" ? new Date(closesAt).getTime() : closesAt.getTime();
  if (Number.isNaN(end)) return "";
  const ms = end - nowMs;
  if (ms <= 0) return "0s";
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function useVotingCountdown(closesAt: string | null | undefined) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const endMs = closesAt ? new Date(closesAt).getTime() : NaN;
  const active = Boolean(closesAt) && !Number.isNaN(endMs);
  const remainingMs = active ? endMs - now : 0;
  const expired = active && remainingMs <= 0;
  const label = active ? formatRemainingUntil(closesAt!, now) : null;

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  useEffect(() => {
    if (!expired) return;
    router.refresh();
  }, [expired, router]);

  return { active, expired, remainingMs, label };
}

type VotingCountdownProps = {
  closesAt: string | null | undefined;
  className?: string;
  /** Shown while time remains, e.g. "Voting ends in". */
  prefix?: string;
  /** Shown when the deadline has passed. */
  expiredLabel?: string;
  /** Use span for inline card descriptions. */
  inline?: boolean;
};

export function VotingCountdown({
  closesAt,
  className,
  prefix = "Voting ends in",
  expiredLabel = "Voting deadline has passed.",
  inline = false,
}: VotingCountdownProps) {
  const { active, expired, label } = useVotingCountdown(closesAt);
  if (!active || !label) return null;

  const text = expired ? expiredLabel : `${prefix} ${label}`;
  const resolvedClass = className ?? "text-sm text-muted-foreground";
  if (inline) {
    return <span className={resolvedClass}>{text}</span>;
  }
  return <p className={resolvedClass}>{text}</p>;
}
