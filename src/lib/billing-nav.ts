/**
 * Billing API routes redirect to Polar (external). Next.js client soft-nav
 * does not follow those Location headers reliably — use a full page load.
 */
export function goToBilling(path: string) {
  if (typeof window === "undefined") return;
  window.location.assign(path);
}
