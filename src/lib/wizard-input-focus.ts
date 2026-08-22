import { useCallback, useEffect, useRef } from "react";

function resolveFocusTarget(
  pending: string,
  refs: Map<string, HTMLElement>,
): HTMLElement | null {
  if (pending.startsWith("id:")) {
    return document.getElementById(pending.slice(3));
  }
  return refs.get(pending) ?? null;
}

/** Fallback when sticky chrome cannot be measured yet. */
const STICKY_TOP_OFFSET_FALLBACK_PX = 160;

/**
 * Site header (`top-0`) + create-wizard sticky chrome (`top-14`).
 * Always clear at least this much — never shrink under a short visualViewport.
 */
function measureWizardStickyClearance(): number {
  let clearance = 0;
  const siteHeader = document.querySelector("header.sticky");
  if (siteHeader instanceof HTMLElement) {
    clearance += siteHeader.getBoundingClientRect().height;
  }
  const wizardChrome = document.querySelector("[data-wizard-sticky-chrome]");
  if (wizardChrome instanceof HTMLElement) {
    clearance += wizardChrome.getBoundingClientRect().height;
  }
  // Gap so the label/input is not flush against the chrome edge.
  clearance += 12;
  return Math.max(clearance, STICKY_TOP_OFFSET_FALLBACK_PX);
}

/**
 * Scroll so `element` sits just below sticky chrome and above the mobile keyboard.
 */
function scrollAboveKeyboard(element: HTMLElement) {
  const clearance = measureWizardStickyClearance();
  const previousMargin = element.style.scrollMarginTop;
  element.style.scrollMarginTop = `${clearance}px`;

  const adjust = () => {
    const vv = window.visualViewport;
    const visibleTop = vv?.offsetTop ?? 0;
    const visibleHeight = vv?.height ?? window.innerHeight;
    const rect = element.getBoundingClientRect();

    // Always clear the full sticky stack (do not use min(viewport*0.22) — that
    // put fields under the locked header when the keyboard was open).
    const targetTop = visibleTop + clearance;
    let delta = rect.top - targetTop;

    // If the field (or its bottom) sits under the keyboard, pull it up further.
    const safeBottom = visibleTop + visibleHeight - 16;
    if (rect.bottom > safeBottom) {
      delta = Math.max(delta, rect.bottom - safeBottom);
    }

    if (Math.abs(delta) > 6) {
      window.scrollBy({ top: delta, behavior: "smooth" });
    }
  };

  // scroll-margin-top keeps block:start below sticky chrome.
  element.scrollIntoView({ block: "start", behavior: "smooth" });
  requestAnimationFrame(() => {
    adjust();
    // Keyboard animation often finishes after focus; adjust again.
    window.setTimeout(adjust, 350);
    window.setTimeout(() => {
      adjust();
      element.style.scrollMarginTop = previousMargin;
    }, 700);
  });

  const vv = window.visualViewport;
  if (vv) {
    const onVvChange = () => adjust();
    vv.addEventListener("resize", onVvChange);
    vv.addEventListener("scroll", onVvChange);
    window.setTimeout(() => {
      vv.removeEventListener("resize", onVvChange);
      vv.removeEventListener("scroll", onVvChange);
    }, 800);
  }
}

export type WizardFocusOptions = {
  /** Scroll the window to the top (use on wizard Next/Back). */
  pageTop?: boolean;
  /**
   * Scroll so the field stays visible below sticky chrome and above the
   * mobile keyboard (use after “Add another …”).
   */
  keyboardSafe?: boolean;
};

/**
 * Focus the primary input after "Add another …" or when entering a wizard step.
 * Register inputs by key; call focusKey / focusById when the target should receive focus.
 */
export function useWizardInputFocus(deps: unknown[]) {
  const refs = useRef(new Map<string, HTMLElement>());
  const pendingKey = useRef<string | null>(null);
  const pendingOptions = useRef<WizardFocusOptions>({});

  const tryFocus = useCallback(() => {
    const pending = pendingKey.current;
    if (!pending) return false;

    const element = resolveFocusTarget(pending, refs.current);
    if (element && typeof element.focus === "function") {
      const { pageTop = false, keyboardSafe = false } = pendingOptions.current;
      if (pageTop) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      // preventScroll: we control scrolling explicitly below.
      element.focus({ preventScroll: true });
      if (pageTop) {
        // Already at page top.
      } else if (keyboardSafe) {
        scrollAboveKeyboard(element);
      } else {
        element.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
      pendingKey.current = null;
      pendingOptions.current = {};
      return true;
    }
    return false;
  }, []);

  const register = useCallback(
    (key: string) => (element: HTMLElement | null) => {
      if (element) refs.current.set(key, element);
      else refs.current.delete(key);
    },
    [],
  );

  const scheduleFocus = useCallback(
    (key: string, options: WizardFocusOptions = {}) => {
      pendingKey.current = key;
      pendingOptions.current = options;
      // After paint: new rows / step panels may not be mounted yet on the same tick.
      requestAnimationFrame(() => {
        if (tryFocus()) return;
        requestAnimationFrame(() => {
          if (tryFocus()) return;
          // Selects / dialog-delayed mounts: one short retry.
          window.setTimeout(() => {
            tryFocus();
          }, 50);
        });
      });
    },
    [tryFocus],
  );

  const focusKey = useCallback(
    (key: string, options?: WizardFocusOptions) => {
      scheduleFocus(key, options);
    },
    [scheduleFocus],
  );

  const focusById = useCallback(
    (id: string, options?: WizardFocusOptions) => {
      scheduleFocus(`id:${id}`, options);
    },
    [scheduleFocus],
  );

  useEffect(() => {
    tryFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps supplied by caller when lists/step change
  }, deps);

  return { register, focusKey, focusById };
}
