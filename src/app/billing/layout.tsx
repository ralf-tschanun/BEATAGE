import type { Metadata } from "next";

/** Account / billing — do not index. */
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function BillingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
