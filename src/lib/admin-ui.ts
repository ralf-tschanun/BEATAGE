import { cn } from "@/lib/utils";

/** Shared select styling for host settings (create + edit). */
export const ADMIN_SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";

export const ADMIN_RADIO_CLASS = "mt-1 size-4 shrink-0 accent-primary";

export const ADMIN_CHECKBOX_CLASS = "mt-1 size-4 shrink-0 accent-primary";

export function adminOptionCardClass(selected: boolean, disabled = false) {
  return cn(
    "flex items-start gap-3 rounded-lg border p-3 transition-colors",
    disabled
      ? "cursor-not-allowed border-border opacity-60"
      : cn(
          "cursor-pointer",
          selected
            ? "border-primary/45 bg-primary/5 ring-1 ring-primary/15"
            : "border-border hover:bg-muted/40",
        ),
  );
}

export function adminChipClass(selected: boolean) {
  return cn(
    "rounded-md border px-2 py-1 text-xs transition-colors",
    selected
      ? "border-primary/45 bg-primary/10 font-medium text-foreground"
      : "border-border text-muted-foreground hover:bg-muted/60",
  );
}

export const ADMIN_HIGHLIGHT_PANEL_CLASS =
  "space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3";
