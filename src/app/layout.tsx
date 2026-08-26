import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import {
  SYSTEM_THEME_BOOTSTRAP,
  SystemThemeSync,
} from "@/components/system-theme-sync";
import { BRAND_NAME, brandHtmlTitle } from "@/lib/brand";
import { CANONICAL_SITE_URL } from "@/lib/site-url";
import { SITE_DESCRIPTION, SITE_KEYWORDS, siteJsonLd } from "@/lib/seo";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_SITE_URL),
  title: {
    default: brandHtmlTitle(),
    template: `%s · ${BRAND_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [...SITE_KEYWORDS],
  applicationName: BRAND_NAME,
  authors: [{ name: "gosmooth", url: "https://gosmooth.eu" }],
  creator: "gosmooth",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: CANONICAL_SITE_URL,
    siteName: BRAND_NAME,
    title: brandHtmlTitle(),
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: brandHtmlTitle(),
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
  verification: {
    google: "WAjnIO0iDBGoaoqANlaN2D33eHI3LNn0cVVvViNTJlE",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("font-sans", inter.variable)}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_BOOTSTRAP }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd()) }}
        />
      </head>
      <body className={`${inter.variable} ${geistMono.variable} antialiased`}>
        <SystemThemeSync />
        {children}
      </body>
    </html>
  );
}
