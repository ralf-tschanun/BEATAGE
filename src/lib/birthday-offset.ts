/** Signed birthday → chart-date offset for Birthday Song Contest. */

export type BirthdayOffsetUnit = "months" | "years";

export type BirthdayDateOffset = {
  amount: number;
  unit: BirthdayOffsetUnit;
};

export const BIRTHDAY_OFFSET_PRESETS: Array<{
  label: string;
  amount: number;
  unit: BirthdayOffsetUnit;
}> = [
  { label: "Birthday itself", amount: 0, unit: "years" },
  { label: "−9 months", amount: -9, unit: "months" },
  { label: "+1 year", amount: 1, unit: "years" },
  { label: "+16 years", amount: 16, unit: "years" },
  { label: "+18 years", amount: 18, unit: "years" },
  { label: "+25 years", amount: 25, unit: "years" },
  { label: "+50 years", amount: 50, unit: "years" },
];

export function parseBirthdayOffsetUnit(value: unknown): BirthdayOffsetUnit {
  return value === "months" ? "months" : "years";
}

export function parseBirthdayOffsetAmount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-200, Math.min(200, Math.trunc(n)));
}

export function parseBirthdayDateOffset(input: {
  amount?: unknown;
  unit?: unknown;
}): BirthdayDateOffset {
  return {
    amount: parseBirthdayOffsetAmount(input.amount),
    unit: parseBirthdayOffsetUnit(input.unit),
  };
}

/** Shift YYYY-MM-DD by months/years (UTC calendar). Returns null if invalid. */
export function applyBirthdayOffset(
  birthdayIso: string,
  amount: number,
  unit: BirthdayOffsetUnit = "years",
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdayIso)) return null;
  if (!Number.isFinite(amount) || amount === 0) return birthdayIso;

  const year = Number(birthdayIso.slice(0, 4));
  const month = Number(birthdayIso.slice(5, 7));
  const day = Number(birthdayIso.slice(8, 10));
  if (![year, month, day].every((n) => Number.isFinite(n))) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;

  if (unit === "years") {
    date.setUTCFullYear(date.getUTCFullYear() + amount);
  } else {
    date.setUTCMonth(date.getUTCMonth() + amount);
  }

  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function formatBirthdayOffsetLabel(offset: BirthdayDateOffset): string {
  const { amount, unit } = offset;
  if (amount === 0) return "the birthday itself";
  const abs = Math.abs(amount);
  const unitLabel =
    unit === "years"
      ? abs === 1
        ? "year"
        : "years"
      : abs === 1
        ? "month"
        : "months";
  if (amount < 0) return `${abs} ${unitLabel} before the birthday`;
  return `${abs} ${unitLabel} after the birthday`;
}

export function formatBirthdayOffsetShort(offset: BirthdayDateOffset): string {
  const { amount, unit } = offset;
  if (amount === 0) return "birthday";
  const sign = amount > 0 ? "+" : "";
  const unitShort = unit === "years" ? "y" : "mo";
  return `${sign}${amount}${unitShort}`;
}
