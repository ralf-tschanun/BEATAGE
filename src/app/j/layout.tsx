import type { Metadata } from "next";

/** Join-by-code deep links — do not index ephemeral invite URLs. */
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function JoinCodeLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
