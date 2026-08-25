import Link from "next/link";
import { BRAND_NAME } from "@/lib/brand";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-border/60 bg-muted/30">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link
            href="/help"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Help
          </Link>
          <Link
            href="/about"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            About us
          </Link>
          <Link
            href="/impressum"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Impressum
          </Link>
          <Link
            href="/contact"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Contact
          </Link>
        </nav>
        <p className="text-sm text-muted-foreground">
          © {year} {BRAND_NAME} · gosmooth.eu. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
