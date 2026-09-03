"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useScreenWakeLock } from "@/lib/use-screen-wake-lock";
import { cn } from "@/lib/utils";

type ScreenLockFieldProps = {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
};

/** Toggle UI only — parent owns wake-lock state so it can outlive this panel. */
export function ScreenLockField({
  id,
  checked,
  onCheckedChange,
  disabled = false,
  className,
}: ScreenLockFieldProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 text-xs text-muted-foreground",
        !disabled && "cursor-pointer",
        className,
      )}
      onClick={() => {
        if (disabled) return;
        onCheckedChange(!checked);
      }}
    >
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        Screen lock
      </Label>
      <span className="min-w-[1.75rem] text-xs tabular-nums">
        {checked ? "On" : "Off"}
      </span>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        onClick={(event) => event.stopPropagation()}
        className="scale-90"
      />
    </div>
  );
}

type LiveHostScreenLockFieldProps = {
  id: string;
  disabled?: boolean;
  className?: string;
};

export function LiveHostScreenLockField({
  id,
  disabled = false,
  className,
}: LiveHostScreenLockFieldProps) {
  const [screenLockOn, setScreenLockOn] = useState(false);
  const { supported } = useScreenWakeLock(screenLockOn);

  if (!supported) return null;

  return (
    <ScreenLockField
      id={id}
      checked={screenLockOn}
      onCheckedChange={setScreenLockOn}
      disabled={disabled}
      className={className}
    />
  );
}
