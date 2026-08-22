"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type AdminSwitchFieldProps = {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
};

export function AdminSwitchField({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  className,
}: AdminSwitchFieldProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 rounded-lg border border-border p-3",
        !disabled && "cursor-pointer",
        className,
      )}
      onClick={() => {
        if (disabled) return;
        onCheckedChange(!checked);
      }}
    >
      <div className="min-w-0 space-y-1 pointer-events-none">
        <Label htmlFor={id} className="leading-snug">
          {label}
        </Label>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        onClick={(event) => event.stopPropagation()}
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}
