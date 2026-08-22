import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <SiteHeader identity={null} currentPlan="free" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">About us</h1>
        <p className="mt-4 text-muted-foreground">
          BEATAGE is a music quiz where the host plays a track and participants
          guess the release year. Same guest-first flow as our other apps — create
          a quiz, invite friends, score points, present the winner.
          nominate, vote, and reveal winners together — from song contests to
          photo polls and tasting nights.
        </p>
        <Link href="/" className="mt-8 inline-block text-sm underline-offset-2 hover:underline">
          ← Back to home
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
