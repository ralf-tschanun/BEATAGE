import type { Metadata } from "next";
import { BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Join a quiz",
  description: `Enter a quiz code or scan a QR code to join a ${BRAND_NAME} music year quiz with friends.`,
  alternates: {
    canonical: "/join",
  },
};

export default function JoinLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
