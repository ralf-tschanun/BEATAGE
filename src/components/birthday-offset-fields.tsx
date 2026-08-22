"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  BIRTHDAY_OFFSET_PRESETS,
  formatBirthdayOffsetLabel,
  type BirthdayOffsetUnit,
} from "@/lib/birthday-offset";
import { ADMIN_SELECT_CLASS, adminChipClass } from "@/lib/admin-ui";

type BirthdayOffsetFieldsProps = {
  amount: number;
  unit: BirthdayOffsetUnit;
  onAmountChange: (amount: number) => void;
  onUnitChange: (unit: BirthdayOffsetUnit) => void;
  amountId?: string;
  unitId?: string;
};

export function BirthdayOffsetFields({
  amount,
  unit,
  onAmountChange,
  onUnitChange,
  amountId = "birthdayOffsetAmount",
  unitId = "birthdayOffsetUnit",
}: BirthdayOffsetFieldsProps) {
  return (
    <div className="space-y-3 rounded-lg border border-dashed p-3">
      <div className="space-y-2">
        <Label>Chart date relative to birthday</Label>
        <p className="text-xs text-muted-foreground">
          Look up the chart #1 for{" "}
          <span className="font-medium text-foreground">
            {formatBirthdayOffsetLabel({ amount, unit })}
          </span>
          . Examples: −9 months (around conception) or +18 years (18th birthday).
          If the target date is in the future or has no chart data, the latest
          available #1 is used.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {BIRTHDAY_OFFSET_PRESETS.map((preset) => {
            const active = preset.amount === amount && preset.unit === unit;
            return (
              <button
                key={preset.label}
                type="button"
                className={adminChipClass(active)}
                onClick={() => {
                  onAmountChange(preset.amount);
                  onUnitChange(preset.unit);
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={amountId}>Offset</Label>
          <Input
            id={amountId}
            type="number"
            min={-200}
            max={200}
            step={1}
            value={amount}
            onChange={(event) => onAmountChange(Number(event.target.value) || 0)}
            className="w-28"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={unitId}>Unit</Label>
          <select
            id={unitId}
            className={ADMIN_SELECT_CLASS}
            value={unit}
            onChange={(event) =>
              onUnitChange(event.target.value as BirthdayOffsetUnit)
            }
          >
            <option value="months">months</option>
            <option value="years">years</option>
          </select>
        </div>
      </div>
    </div>
  );
}
