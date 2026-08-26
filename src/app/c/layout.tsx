import type { Metadata } from "next";

/** Contest-style code routes — do not index. */
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function CodeLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
