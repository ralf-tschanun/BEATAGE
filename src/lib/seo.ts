import { BRAND_NAME } from "@/lib/brand";
import { CANONICAL_SITE_URL } from "@/lib/site-url";

/** Default meta description for marketing / indexable pages. */
export const SITE_DESCRIPTION =
  "Guess the release year — the host plays a track on Spotify, everyone scores years off. Music quiz nights with friends.";

export const SITE_KEYWORDS = [
  "music quiz",
  "release year quiz",
  "guess the year",
  "Spotify quiz",
  "party game",
  "BEATAGE",
  "music trivia",
] as const;

/** JSON-LD WebApplication payload for the public site. */
export function siteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: BRAND_NAME,
    url: CANONICAL_SITE_URL,
    description: SITE_DESCRIPTION,
    applicationCategory: "GameApplication",
    operatingSystem: "Web browser",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "EUR",
    },
  };
}
