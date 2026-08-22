/** Minimum / maximum nomination window length (1 second … 24 hours). */
export const NOMINATION_DURATION_MIN_SECONDS = 1;
export const NOMINATION_DURATION_MAX_SECONDS = 24 * 60 * 60;

export function clampNominationDurationSeconds(raw: number): number {
  if (!Number.isFinite(raw)) return 30 * 60;
  return Math.min(
    NOMINATION_DURATION_MAX_SECONDS,
    Math.max(NOMINATION_DURATION_MIN_SECONDS, Math.floor(raw)),
  );
}

/** Split without forcing a 1s minimum (allows empty/0 while editing). */
export function splitNominationDuration(totalSeconds: number): {
  hours: number;
  minutes: number;
  seconds: number;
} {
  const total = Math.min(
    NOMINATION_DURATION_MAX_SECONDS,
    Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0)),
  );
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return { hours, minutes, seconds };
}

/** Combine H/M/S; may be 0 while the user is still typing. */
export function combineNominationDuration(
  hours: number,
  minutes: number,
  seconds: number,
): number {
  const h = Math.max(0, Math.floor(hours) || 0);
  const m = Math.max(0, Math.floor(minutes) || 0);
  const s = Math.max(0, Math.floor(seconds) || 0);
  return Math.min(NOMINATION_DURATION_MAX_SECONDS, h * 3600 + m * 60 + s);
}

/** Human-readable duration, e.g. "30m", "1h 5m", "45s". */
export function formatNominationDuration(totalSeconds: number): string {
  const clamped = clampNominationDurationSeconds(
    totalSeconds > 0 ? totalSeconds : NOMINATION_DURATION_MIN_SECONDS,
  );
  const { hours, minutes, seconds } = splitNominationDuration(clamped);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}
