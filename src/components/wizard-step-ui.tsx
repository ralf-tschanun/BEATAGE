"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChangePlanForm } from "@/components/change-plan-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  combineNominationDuration,
  formatNominationDuration,
  splitNominationDuration,
} from "@/lib/nomination-duration";
import { cn } from "@/lib/utils";
import { getPlanLimits, type PlanId } from "@/lib/plans";

/** Section divider before optional settings on create-wizard steps. */
export function WizardOptionsDivider({
  label = "Options",
}: {
  /** Section label under the rule; pass null for a plain divider. */
  label?: string | null;
} = {}) {
  return (
    <div className="space-y-3 pt-2">
      <div className="border-t-2 border-primary/50" />
      {label ? (
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          {label}
        </p>
      ) : null}
    </div>
  );
}

/** Outline “Add another …” — a bit more visible than ghost, not highlighted. */
export function WizardAddAnotherButton({
  children,
  onClick,
  disabled,
  overPlan = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  overPlan?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      className={cn(
        "w-full font-medium",
        overPlan && "border-muted-foreground/35 text-muted-foreground",
      )}
      disabled={disabled}
      // Keep focus in the active input until click runs. Otherwise blur collapses
      // optional Anything fields, the button jumps, and the first click is lost.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

const PRO_WHEEL_VALUES = Array.from({ length: 15 }, (_, i) => i + 6);

/** Included nominations per participant on the account plan; null = unlimited. */
export function nominationsIncludedInPlan(planId: PlanId): number | null {
  return getPlanLimits(planId).maxNominationsPerParticipant;
}

function nominationChipsForPlan(_planId: PlanId): number[] {
  return [1, 2, 3, 4, 5];
}

function isOverPlanNomination(value: number, planId: PlanId): boolean {
  const included = nominationsIncludedInPlan(planId);
  return included != null && value > included;
}

type NominationsPerParticipantPickerProps = {
  planId: PlanId;
  value: number;
  onChange: (value: number) => void;
  hasSession: boolean;
  isAnonymous?: boolean;
  onOverPlanAttempt?: (action: { apply: () => void; revert: () => void }) => void;
};

/**
 * Free: 1–2. Plus: 1–5. Pro: 1–5 + 6+ wheel.
 * No plan labels on chips; free/plus get a change-plan hint.
 */
export function NominationsPerParticipantPicker({
  planId,
  value,
  onChange,
  hasSession,
  isAnonymous = false,
  onOverPlanAttempt,
}: NominationsPerParticipantPickerProps) {
  const [planOpen, setPlanOpen] = useState(false);
  const chips = nominationChipsForPlan(planId);
  const showSixPlus = planId !== "pro";

  useEffect(() => {
    if (value < 1) onChange(1);
  }, [onChange, value]);

  function pick(next: number) {
    if (isOverPlanNomination(next, planId) && onOverPlanAttempt) {
      const previous = value;
      onOverPlanAttempt({
        apply: () => onChange(next),
        revert: () => onChange(previous),
      });
      return;
    }
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <Label>Nominations per participant</Label>
      <div className="flex flex-wrap gap-2">
        {chips.map((n) => {
          const selected = value === n;
          const overPlan = isOverPlanNomination(n, planId);
          return (
            <button
              key={n}
              id={n === chips[0] ? "nominations-per-participant" : undefined}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(n)}
              className={cn(
                "inline-flex min-w-10 items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                selected
                  ? overPlan
                    ? "border-muted-foreground/50 bg-muted/40 text-foreground"
                    : "border-primary bg-primary/10 text-primary"
                  : overPlan
                    ? "border-muted-foreground/35 bg-background text-muted-foreground hover:bg-muted/50"
                    : "border-input bg-background hover:bg-muted/60",
              )}
              aria-pressed={selected}
            >
              {n}
            </button>
          );
        })}
        {showSixPlus ? (
          <select
            className={cn(
              "inline-flex min-w-20 items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium transition-colors outline-none",
              "bg-background text-foreground shadow-xs focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30",
              value > 5
                ? isOverPlanNomination(value, planId)
                  ? "border-muted-foreground/50 bg-muted/40 font-medium text-foreground"
                  : "border-primary bg-primary/10 text-primary"
                : isOverPlanNomination(6, planId)
                  ? "border-muted-foreground/35 text-muted-foreground hover:bg-muted/50"
                  : "border-input hover:bg-muted/60",
            )}
            value={value > 5 ? String(value) : ""}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next) && next >= 6) pick(next);
            }}
            aria-label="More than 5 nominations"
          >
            <option value="" disabled>
              6+
            </option>
            {PRO_WHEEL_VALUES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {nominationsIncludedInPlan(planId) != null ? (
        <p className="text-xs text-muted-foreground">
          Your plan includes up to {nominationsIncludedInPlan(planId)} nominations per
          participant. Higher values need a contest unlock at create — or{" "}
          <button
            type="button"
            className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
            onClick={() => setPlanOpen(true)}
          >
            manage plan
          </button>
          .
        </p>
      ) : null}
      <ChangePlanForm
        currentPlan={planId}
        hasSession={hasSession}
        isAnonymous={isAnonymous}
        open={planOpen}
        onOpenChange={setPlanOpen}
        showTrigger={false}
      />
    </div>
  );
}

type NominationDurationPickerProps = {
  valueSeconds: number;
  onChange: (seconds: number) => void;
};

function DurationNumberField({
  id,
  label,
  value,
  max,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  max: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft !== null ? draft : String(value);

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={0}
        max={max}
        className="w-20"
        value={display}
        onFocus={() => setDraft(String(value))}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          if (raw === "") return;
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          onCommit(Math.min(max, Math.max(0, Math.floor(n))));
        }}
        onBlur={() => {
          if (draft === null) return;
          if (draft === "") {
            onCommit(0);
          } else {
            const n = Number(draft);
            onCommit(
              Number.isFinite(n)
                ? Math.min(max, Math.max(0, Math.floor(n)))
                : 0,
            );
          }
          setDraft(null);
        }}
      />
    </div>
  );
}

/** Hours / minutes / seconds controls for 1s–24h nomination windows. */
export function NominationDurationPicker({
  valueSeconds,
  onChange,
}: NominationDurationPickerProps) {
  const { hours, minutes, seconds } = splitNominationDuration(valueSeconds);

  function commit(nextH: number, nextM: number, nextS: number) {
    onChange(combineNominationDuration(nextH, nextM, nextS));
  }

  return (
    <div className="space-y-2">
      <Label>Nomination window length</Label>
      <div className="flex flex-wrap items-end gap-3">
        <DurationNumberField
          id="nom-duration-h"
          label="Hours"
          value={hours}
          max={24}
          onCommit={(h) => commit(h, minutes, seconds)}
        />
        <DurationNumberField
          id="nom-duration-m"
          label="Minutes"
          value={minutes}
          max={59}
          onCommit={(m) => commit(hours, m, seconds)}
        />
        <DurationNumberField
          id="nom-duration-s"
          label="Seconds"
          value={seconds}
          max={59}
          onCommit={(s) => commit(hours, minutes, s)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        After you start nominations, they close automatically after{" "}
        {valueSeconds > 0
          ? formatNominationDuration(valueSeconds)
          : "…"}{" "}
        (1 second – 24 hours).
      </p>
    </div>
  );
}
