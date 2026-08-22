"use client";

import { useEffect } from "react";

const DARK_MQ = "(prefers-color-scheme: dark)";

function applySystemTheme(isDark: boolean) {
  document.documentElement.classList.toggle("dark", isDark);
}

/** Keeps the `dark` class on <html> in sync with the OS color scheme. */
export function SystemThemeSync() {
  useEffect(() => {
    const media = window.matchMedia(DARK_MQ);
    const onChange = () => applySystemTheme(media.matches);

    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return null;
}

/** Inline bootstrap to avoid a light flash before React hydrates. */
export const SYSTEM_THEME_BOOTSTRAP = `(function(){try{var m=window.matchMedia('${DARK_MQ}');document.documentElement.classList.toggle('dark',m.matches);}catch(e){}})();`;
