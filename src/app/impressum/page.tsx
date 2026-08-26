import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { PlanId } from "@/lib/quiz-plans";
import { getQuizDashboardData } from "@/lib/quizzes/dashboard";

export const metadata: Metadata = {
  title: "Impressum",
  description: "Legal notice and operator details for this site.",
  alternates: {
    canonical: "/impressum",
  },
};

export default async function ImpressumPage() {
  const { identity, plan } = await getQuizDashboardData();

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <SiteHeader identity={identity} currentPlan={plan.id as PlanId} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Impressum</h1>
        <div className="mt-6 space-y-6 text-sm leading-relaxed text-muted-foreground">
          <section className="space-y-1">
            <h2 className="font-medium text-foreground">Provider</h2>
            <p>Ralf Tschanun</p>
            <p>
              Neustiftgasse 32/12
              <br />
              A-1070 Vienna
              <br />
              Austria
            </p>
          </section>

          <section className="space-y-1">
            <h2 className="font-medium text-foreground">Contact</h2>
            <p>
              Please use the{" "}
              <Link
                href="/contact"
                className="text-foreground underline-offset-2 hover:underline"
              >
                contact form
              </Link>
              .
            </p>
          </section>
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
