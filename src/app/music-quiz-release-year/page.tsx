import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { buttonVariants } from "@/components/ui/button";
import { BRAND_NAME } from "@/lib/brand";
import { CANONICAL_SITE_URL } from "@/lib/site-url";
import { cn } from "@/lib/utils";

const PAGE_PATH = "/music-quiz-release-year";
const PAGE_TITLE = "Music quiz: guess the release year";
const PAGE_DESCRIPTION =
  "Host a music quiz with friends — play a track on Spotify, everyone guesses the release year or release date era. Live scoring, invite code, and a final leaderboard.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    "music quiz",
    "music quiz release year",
    "music quiz release date",
    "guess the year quiz",
    "Spotify release year quiz",
    "party music trivia",
    BRAND_NAME,
  ],
  alternates: {
    canonical: PAGE_PATH,
  },
  openGraph: {
    title: `${PAGE_TITLE} · ${BRAND_NAME}`,
    description: PAGE_DESCRIPTION,
    url: `${CANONICAL_SITE_URL}${PAGE_PATH}`,
    type: "website",
  },
};

const FAQ_ITEMS: Array<{ question: string; answer: string }> = [
  {
    question: "What is a music quiz about the release year?",
    answer: `${BRAND_NAME} is a live party game: the host plays a song (usually on Spotify), and everyone else guesses the original release year. Closer guesses score better — fewer years off wins the round.`,
  },
  {
    question: "Do players need a Spotify account?",
    answer:
      "No. Only the host plays music. Guests join with an invite code or QR link in the browser and enter their year guess each round — no Spotify login required for players.",
  },
  {
    question: "Is this the same as guessing the release date?",
    answer:
      "Most rounds ask for the release year (the date people remember from charts and albums). That is the classic “guess when this track came out” music trivia format — perfect for release-date vibes without typing full calendar dates.",
  },
  {
    question: "How do I start a quiz night?",
    answer: `Open ${BRAND_NAME}, create a quiz, share the code or QR with friends, then play tracks while everyone guesses. You can use curated song lists or live listening modes with Spotify / Last.fm.`,
  },
  {
    question: "Is it free to try?",
    answer:
      "Yes. You can create and host on the free plan with plan limits. Paid unlocks and higher plans are optional when you need more active quizzes, songs, or participants.",
  },
];

function faqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-border/60 pt-10 first:border-t-0 first:pt-0">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="space-y-3 text-base leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export default function MusicQuizReleaseYearPage() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd()) }}
      />
      <SiteHeader identity={null} currentPlan="free" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <p className="text-sm font-medium text-muted-foreground">{BRAND_NAME}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Music quiz: guess the release year
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Looking for a music quiz about release dates and release years?{" "}
          {BRAND_NAME} turns any playlist into a live night with friends: the host
          plays the track, everyone guesses the year it came out, and scores update
          in real time.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/create"
            className={cn(
              buttonVariants({ size: "lg" }),
              "justify-center px-6",
            )}
          >
            Create a music quiz
          </Link>
          <Link
            href="/join"
            className={cn(
              buttonVariants({ size: "lg", variant: "outline" }),
              "justify-center px-6",
            )}
          >
            Join with a code
          </Link>
        </div>

        <div className="mt-14 space-y-0">
          <Section title="How the release-year quiz works">
            <p>
              One person hosts. They play a song — from a curated list or live from
              Spotify — while the room listens. Everyone else types the{" "}
              <strong className="font-medium text-foreground">release year</strong>{" "}
              they think is correct. The closer you are, the better your score for
              that round.
            </p>
            <p>
              After enough rounds, the host can reveal a leaderboard. It is the
              classic party format: music trivia without trivia cards, built for
              phones around one speaker.
            </p>
          </Section>

          <Section title="Why release year (not the full release date)?">
            <p>
              People remember eras — “that’s late-80s”, “early 2000s pop” — more
              often than exact day-month-year. Guessing the{" "}
              <strong className="font-medium text-foreground">
                original release year
              </strong>{" "}
              keeps rounds fast and fair, while still answering the “when did this
              come out?” question behind release-date music quizzes.
            </p>
          </Section>

          <Section title="What you need">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                A host with a browser tab open on the quiz page (and music ready —
                Spotify Premium for live host modes).
              </li>
              <li>
                Friends on any phone or laptop — they join with a short code or QR,
                no app install.
              </li>
              <li>
                Optional: Last.fm scrobbling if you run live rounds from the host’s
                listening history.
              </li>
            </ul>
          </Section>

          <Section title="Start in under a minute">
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                <Link href="/create" className="underline underline-offset-2 hover:text-foreground">
                  Create a quiz
                </Link>{" "}
                and pick curated tracks or a live listening mode.
              </li>
              <li>Share the invite code or QR so everyone joins the room.</li>
              <li>
                Play a track, open the round, collect year guesses, and show who was
                closest.
              </li>
            </ol>
            <p>
              Need setup details? See the{" "}
              <Link href="/help" className="underline underline-offset-2 hover:text-foreground">
                help guide
              </Link>
              .
            </p>
          </Section>

          <Section title="FAQ">
            <dl className="space-y-6">
              {FAQ_ITEMS.map((item) => (
                <div key={item.question} className="space-y-2">
                  <dt className="font-medium text-foreground">{item.question}</dt>
                  <dd>{item.answer}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-border/60 pt-10 sm:flex-row">
          <Link
            href="/create"
            className={cn(
              buttonVariants({ size: "lg" }),
              "justify-center px-6",
            )}
          >
            Start hosting {BRAND_NAME}
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            ← Back to home
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
