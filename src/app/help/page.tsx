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

          <HelpSection title="One-time: Spotify → Last.fm">
            <p>
              Live mode follows Spotify through Last.fm (no Spotify Developer
              allowlist). Do this once on the account that will play music:
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
                account if you need one.
              </li>
              <li>
                In the <strong className="font-medium text-foreground">Spotify app</strong>:
                Settings → Social / Connections → connect Last.fm.
              </li>
              <li>
                In {BRAND_NAME}, enter that{" "}
                <strong className="font-medium text-foreground">Last.fm username</strong>{" "}
                when you create a Live quiz (or on the host panel later).
              </li>
            </ol>
            <p>
              Scrobbles can lag a few seconds. If nothing appears, check that Spotify
              is actually playing and still linked to Last.fm.
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
