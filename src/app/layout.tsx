import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import {
  SYSTEM_THEME_BOOTSTRAP,
  SystemThemeSync,
} from "@/components/system-theme-sync";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BEATAGE",
  description: "Guess the release year — host plays a track, participants score points.",
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
      </head>
      <body
        className={`${inter.variable} ${geistMono.variable} antialiased`}
      >
        <SystemThemeSync />
        {children}
      </body>
    </html>
  );
}
