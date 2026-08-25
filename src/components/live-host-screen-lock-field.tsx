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
  const [preventScreenLock, setPreventScreenLock] = useState(false);
  const { supported } = useScreenWakeLock(preventScreenLock);

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
        setPreventScreenLock((prev) => !prev);
      }}
    >
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        Prevent Screen Lock
      </Label>
      <Switch
        id={id}
        checked={preventScreenLock}
        onCheckedChange={setPreventScreenLock}
        disabled={disabled}
        onClick={(event) => event.stopPropagation()}
        className="scale-90"
      />
    </div>
  );
}
