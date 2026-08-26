"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useScreenWakeLock } from "@/lib/use-screen-wake-lock";
import { cn } from "@/lib/utils";

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
    <div
      className={cn(
        "inline-flex items-center gap-2 text-xs text-muted-foreground",
        !disabled && "cursor-pointer",
        className,
      )}
      onClick={() => {
        if (disabled) return;
        setScreenLockOn((prev) => !prev);
      }}
    >
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        Screen lock
      </Label>
      <span className="min-w-[1.75rem] text-xs tabular-nums">
        {screenLockOn ? "On" : "Off"}
      </span>
      <Switch
        id={id}
        checked={screenLockOn}
        onCheckedChange={setScreenLockOn}
        disabled={disabled}
        onClick={(event) => event.stopPropagation()}
        className="scale-90"
      />
    </div>
  );
}
