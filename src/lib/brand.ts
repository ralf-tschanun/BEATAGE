/** App brand name — pipe separator is intentional. */
export const BRAND_NAME = "BEAT|AGE";

export function brandHtmlTitle(suffix?: string): string {
  return suffix ? `${BRAND_NAME} · ${suffix}` : BRAND_NAME;
}
