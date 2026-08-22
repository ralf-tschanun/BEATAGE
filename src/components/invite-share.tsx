"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";

type InviteShareProps = {
  joinUrl: string;
  joinCode: string;
  contestTitle?: string;
};

export function InviteShare({
  joinUrl,
  joinCode,
  contestTitle,
}: InviteShareProps) {
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [absoluteJoinUrl, setAbsoluteJoinUrl] = useState(joinUrl);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  useEffect(() => {
    if (joinUrl.startsWith("http")) {
      setAbsoluteJoinUrl(joinUrl);
      return;
    }
    setAbsoluteJoinUrl(`${window.location.origin}${joinUrl}`);
  }, [joinUrl]);

  useEffect(() => {
    if (!absoluteJoinUrl) return;
    let cancelled = false;
    setQrError(null);
    void QRCode.toDataURL(absoluteJoinUrl, {
      width: 360,
      margin: 4,
      errorCorrectionLevel: "H",
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) {
          setQrDataUrl(null);
          setQrError("Could not generate QR code.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [absoluteJoinUrl]);

  async function copy(value: string, kind: "link" | "code") {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 2000);
  }

  function shareWhatsApp() {
    const title = contestTitle?.trim() || "BEATAGE";
    const path = absoluteJoinUrl.startsWith("/")
      ? absoluteJoinUrl
      : absoluteJoinUrl.startsWith("http")
        ? absoluteJoinUrl
        : `/${absoluteJoinUrl}`;
    const url =
      path.startsWith("http://") || path.startsWith("https://")
        ? path
        : `${window.location.origin}${path}`;
    const text = `Join “${title}” on BEATAGE!\n${url}`;
    const href = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(href, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/40 px-3 py-2 font-mono text-sm break-all">
        {absoluteJoinUrl}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => copy(absoluteJoinUrl, "link")}>
          {copied === "link" ? "Copied link" : "Copy invite link"}
        </Button>
        <Button type="button" variant="outline" onClick={() => copy(joinCode, "code")}>
          {copied === "code" ? "Copied code" : `Code: ${joinCode}`}
        </Button>
        <Button type="button" variant="outline" onClick={shareWhatsApp}>
          WhatsApp
        </Button>
      </div>

      <div className="flex flex-col items-center gap-2 pt-2">
        {qrError ? (
          <p className="text-sm text-destructive" role="alert">
            {qrError}
          </p>
        ) : qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrDataUrl}
            alt={`QR code for join code ${joinCode}`}
            className="size-64 rounded-md border bg-white p-3 sm:size-72"
          />
        ) : (
          <p className="text-sm text-muted-foreground">Generating QR code…</p>
        )}
        <p className="text-xs text-muted-foreground">
          Scan to join · Code: {joinCode}
        </p>
      </div>
    </div>
  );
}
