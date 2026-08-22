import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function ImpressumPage() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <SiteHeader identity={null} currentPlan="free" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Impressum</h1>
        <div className="mt-4 space-y-4 text-sm text-muted-foreground">
          <p>
            Legal notice placeholder. Replace with operator name, address, and
            contact details before production use.
          </p>
          <p>
            Email:{" "}
            <Link href="/contact" className="text-foreground underline-offset-2 hover:underline">
              Contact page
            </Link>
          </p>
        </div>
        <Link href="/" className="mt-8 inline-block text-sm underline-offset-2 hover:underline">
          ← Back to home
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
