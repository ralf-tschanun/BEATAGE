"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function isWakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

/** Keep the screen awake while `enabled` (Screen Wake Lock API). */
export function useScreenWakeLock(enabled: boolean) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(isWakeLockSupported());
  }, []);

  const release = useCallback(async () => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    sentinelRef.current = null;
    try {
      await sentinel.release();
    } catch {
      // Already released.
    }
  }, []);

  const request = useCallback(async () => {
    if (!supported || !enabled || document.visibilityState !== "visible") return;
    if (sentinelRef.current) return;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      sentinelRef.current = sentinel;
      sentinel.addEventListener("release", () => {
        if (sentinelRef.current === sentinel) {
          sentinelRef.current = null;
        }
      });
    } catch {
      // Low battery, unsupported context, or user denied.
    }
  }, [enabled, supported]);

  useEffect(() => {
    if (!enabled) {
      void release();
      return;
    }

    void request();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && enabled) {
        void request();
      } else {
        void release();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void release();
    };
  }, [enabled, request, release]);

  return { supported };
}
