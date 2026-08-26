import type { Metadata } from "next";

/** Private quiz rooms — do not index invite/session URLs. */
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function QuizCodeLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
