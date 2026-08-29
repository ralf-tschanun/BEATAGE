import Link from "next/link";
import { CircleNotchIcon, WaveformIcon } from "@phosphor-icons/react/dist/ssr";
import { BRAND_NAME } from "@/lib/brand";

export default function ContestLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <header
        className="sticky top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-sm supports-[backdrop-filter]:bg-background/70"
      >
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 font-bold tracking-tight transition-opacity hover:opacity-80"
          >
            <WaveformIcon className="size-6 shrink-0 text-primary sm:size-7" weight="bold" />
            <span className="text-xl sm:text-2xl">{BRAND_NAME}</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-3 px-6 py-24">
        <CircleNotchIcon
          className="size-8 animate-spin text-muted-foreground"
          aria-hidden
        />
        <p className="text-sm text-muted-foreground">Loading contest…</p>
      </main>
    </div>
  );
}
