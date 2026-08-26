import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { BRAND_NAME, brandHtmlTitle } from "@/lib/brand";

export const metadata: Metadata = {
  title: brandHtmlTitle("Help"),
};

function HelpSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-border/60 pt-8 first:border-t-0 first:pt-0">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export default function HelpPage() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <SiteHeader identity={null} currentPlan="free" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Help</h1>
        <p className="mt-3 text-muted-foreground">
          How {BRAND_NAME} works — host setup, Last.fm, and the live quiz flow.
        </p>

        <div className="mt-10 space-y-0">
          <HelpSection title="The idea">
            <p>
              The host plays songs in Spotify. Everyone else guesses the{" "}
              <strong className="font-medium text-foreground">release year</strong>.
              Closer guesses score fewer years off; the host can present a
              leaderboard at the end.
            </p>
          </HelpSection>

          <HelpSection title="Host: keep the quiz page open">
            <p>
              Live rounds are driven from the{" "}
              <strong className="font-medium text-foreground">host&apos;s browser</strong>.
            </p>
            <p className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-foreground">
              <strong className="font-semibold">Stay on the quiz page</strong> while you
              play — do not close the tab or leave host view. Guests can refresh freely;
              the host session must keep listening for the next track.
            </p>
            <p>
              <strong className="font-medium text-foreground">Tip:</strong> For larger
              events, leave a laptop (or tablet) open on the host page for the whole
              quiz, and play Spotify from that same machine or the linked account.
            </p>
          </HelpSection>

          <HelpSection title="One-time: Connect Spotify → Last.fm">
            <p>
              Live mode follows what you play on Spotify through Last.fm — no Spotify
              Developer allowlist required. Set this up once for the Spotify account
              you&apos;ll use to play music:
            </p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Create a free{" "}
                <a
                  href="https://www.last.fm/join"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground underline-offset-2 hover:underline"
                >
                  Last.fm
                </a>{" "}
                account if you don&apos;t have one.
              </li>
              <li>
                On the <strong className="font-medium text-foreground">Last.fm website</strong>,
                scroll <strong className="font-medium text-foreground">all the way to the bottom of the page</strong>{" "}
                and select <strong className="font-medium text-foreground">ACCOUNT → Settings → Applications</strong>.
                Under <strong className="font-medium text-foreground">Spotify Scrobbling</strong>, click{" "}
                <strong className="font-medium text-foreground">Connect</strong>, then sign in to Spotify and
                authorize the connection.
              </li>
              <li>
                In {BRAND_NAME}, enter your{" "}
                <strong className="font-medium text-foreground">Last.fm username</strong> when creating a Live
                Quiz (you can also add or change it later in the Host Panel).
              </li>
            </ol>
            <p className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-foreground">
              <strong className="font-semibold">Tip:</strong> The ACCOUNT link is easy to miss — it&apos;s located
              at the very bottom of the Last.fm page.
            </p>
            <p>
              Scrobbles may lag by a few seconds. If nothing appears, make sure Spotify is
              playing and <strong className="font-medium text-foreground">Spotify Scrobbling</strong> is still
              connected in your Last.fm settings.
            </p>
          </HelpSection>

          <HelpSection title="Live quiz flow">
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                <Link href="/create" className="text-foreground underline-offset-2 hover:underline">
                  Create a quiz
                </Link>{" "}
                and choose <strong className="font-medium text-foreground">Live Spotify (Last.fm)</strong>.
              </li>
              <li>Share the invite code or QR with guests.</li>
              <li>
                On the host page, confirm your Last.fm username and keep live mode
                running (Pause if you need a break).
              </li>
              <li>
                Play any playlist or song in Spotify on the linked account. After
                about <strong className="font-medium text-foreground">5 seconds</strong>,{" "}
                {BRAND_NAME} opens a round for that track.
              </li>
              <li>
                Skip or change songs in Spotify to move on — a new round opens for
                the next track. End the quiz when you are done.
              </li>
            </ol>
          </HelpSection>

          <HelpSection title="Guests">
            <p>
              Open the invite link or go to{" "}
              <Link href="/join" className="text-foreground underline-offset-2 hover:underline">
                Join
              </Link>
              , enter the code and a display name, then guess the year each round.
              No Spotify or Last.fm needed for guests.
            </p>
          </HelpSection>

          <HelpSection title="Scoring">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong className="font-medium text-foreground">
                  Basic - Closer wins
                </strong>{" "}
                — each year off the answer counts against you. Lowest total wins.
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  Pro - Closer wins - Dynamic
                </strong>{" "}
                — same as Basic, but each year off costs double (points). Lowest
                total wins.
              </li>
              <li>
                <strong className="font-medium text-foreground">No guess</strong> —
                in Closer wins modes, missing a round scores the worst submitted
                miss + 2 (capped; Pro doubles that penalty).
              </li>
              <li>
                <strong className="font-medium text-foreground">Range</strong> —
                you only score within ± years of the answer. Hit the year for max
                points; outside the range you get nothing. Highest total wins.
              </li>
            </ul>
          </HelpSection>

          <HelpSection title="Other options">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong className="font-medium text-foreground">Curate playlist</strong> —
                pick songs ahead (or during the quiz) instead of following Spotify
                live.
              </li>
              <li>
                <strong className="font-medium text-foreground">Host plays along</strong> —
                optional; turn off if you only want to run the room and not guess.
              </li>
            </ul>
          </HelpSection>
        </div>

        <p className="mt-10 text-sm text-muted-foreground">
          Still stuck?{" "}
          <Link href="/contact" className="text-foreground underline-offset-2 hover:underline">
            Contact us
          </Link>
          .
        </p>
        <Link href="/" className="mt-6 inline-block text-sm underline-offset-2 hover:underline">
          ← Back to home
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
