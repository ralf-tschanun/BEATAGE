import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Contact",
  description: `Questions or feedback about ${BRAND_NAME}? Reach the gosmooth team by email.`,
  alternates: {
    canonical: "/contact",
  },
};

export default function ContactPage() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <SiteHeader identity={null} currentPlan="free" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Contact</h1>
        <p className="mt-4 text-muted-foreground">
          Questions, feedback, or support — reach us at{" "}
          <a
            href="mailto:hello@gosmooth.eu"
            className="text-foreground underline-offset-2 hover:underline"
          >
            hello@gosmooth.eu
          </a>
          . (Placeholder address — update for your deployment.)
        </p>
        <Link href="/" className="mt-8 inline-block text-sm underline-offset-2 hover:underline">
          ← Back to home
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
