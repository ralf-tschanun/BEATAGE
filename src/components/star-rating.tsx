"use client";

import { StarIcon } from "@phosphor-icons/react";
import { STAR_RATING_MAX } from "@/lib/plans";
import { cn } from "@/lib/utils";

type StarMeterProps = {
  /** Average or integer stars, 0–5. Fractional values fill the last star by %. */
  value: number;
  className?: string;
  size?: "sm" | "md";
};

export function StarMeter({ value, className, size = "md" }: StarMeterProps) {
  const clamped = Math.max(0, Math.min(STAR_RATING_MAX, value));
  const pct = (clamped / STAR_RATING_MAX) * 100;
  const iconClass = size === "sm" ? "size-3.5" : "size-4";

  return (
    <span
      className={cn("relative inline-flex shrink-0", className)}
      title={`${clamped.toFixed(1)} of ${STAR_RATING_MAX}`}
      aria-label={`${clamped.toFixed(1)} of ${STAR_RATING_MAX} stars`}
    >
      <span className="flex gap-0.5 text-amber-400/35" aria-hidden>
        {Array.from({ length: STAR_RATING_MAX }, (_, index) => (
          <StarIcon key={index} className={iconClass} weight="regular" />
        ))}
      </span>
      <span
        className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden"
        style={{ width: `${pct}%` }}
        aria-hidden
      >
        <span className="flex w-max gap-0.5 text-amber-400">
          {Array.from({ length: STAR_RATING_MAX }, (_, index) => (
            <StarIcon key={index} className={iconClass} weight="fill" />
          ))}
        </span>
      </span>
    </span>
  );
}

type StarRatingInputProps = {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  /** Show the chosen stars without allowing changes. */
  readOnly?: boolean;
  labelledBy?: string;
};

export function StarRatingInput({
  value,
  onChange,
  disabled = false,
  readOnly = false,
  labelledBy,
}: StarRatingInputProps) {
  const current = Math.max(0, Math.min(STAR_RATING_MAX, Math.round(value)));

  return (
    <div
      className="flex shrink-0 justify-end gap-0.5"
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-readonly={readOnly || undefined}
    >
      {Array.from({ length: STAR_RATING_MAX }, (_, index) => {
        const stars = index + 1;
        const filled = stars <= current;
        return (
          <button
            key={stars}
            type="button"
            role="radio"
            aria-checked={current === stars}
            aria-label={`${stars} star${stars === 1 ? "" : "s"}`}
            disabled={disabled}
            tabIndex={readOnly ? -1 : undefined}
            className={cn(
              "rounded-sm p-0.5 text-amber-400/40 transition-colors",
              filled ? "text-amber-400" : !readOnly && !disabled && "hover:text-amber-300",
              disabled
                ? "cursor-not-allowed opacity-60"
                : readOnly
                  ? "pointer-events-none cursor-default"
                  : "cursor-pointer",
            )}
            onClick={() => {
              if (readOnly || disabled) return;
              onChange(current === stars ? 0 : stars);
            }}
          >
            <StarIcon
              className="size-4"
              weight={filled ? "fill" : "regular"}
            />
          </button>
        );
      })}
    </div>
  );
}
