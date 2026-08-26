import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/contact-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { BRAND_NAME } from "@/lib/brand";
import type { PlanId } from "@/lib/quiz-plans";
import { getQuizDashboardData } from "@/lib/quizzes/dashboard";

export const metadata: Metadata = {
  title: "Contact",
  description: `Questions or feedback about ${BRAND_NAME}? Send us a message.`,
  alternates: {
    canonical: "/contact",
  },
};

export default async function ContactPage() {
  const { identity, plan } = await getQuizDashboardData();
  const defaultEmail =
    identity && !identity.isAnonymous ? identity.email : null;

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <SiteHeader identity={identity} currentPlan={plan.id as PlanId} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Contact</h1>
        <p className="mt-4 text-muted-foreground">
          Questions, feedback, or support — send us a short message and we’ll
          reply by email.
        </p>

        <div className="mt-8 rounded-2xl border border-border/60 bg-card p-4 sm:p-6">
          <ContactForm defaultEmail={defaultEmail} />
        </div>

        <Link
          href="/"
          className="mt-8 inline-block text-sm underline-offset-2 hover:underline"
        >
          ← Back to home
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
