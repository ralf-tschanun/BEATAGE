"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { isContestImageUrl } from "@/lib/contest-photos";
import { cn } from "@/lib/utils";

/**
 * Shared photo preview size — nominate pick, wizard drafts.
 * Keep in sync with PhotoPickFields.
 */
export const PHOTO_LIST_PREVIEW_CLASS =
  "max-h-64 w-full max-w-full rounded-lg border object-contain bg-muted/30";

/**
 * Compact attachment preview (Anything create + nominate).
 * Prefer fixed max height in px so Safari does not ignore Tailwind max-h.
 */
export const PHOTO_ATTACHMENT_PREVIEW_CLASS =
  "h-auto max-h-40 w-auto max-w-full rounded-lg border object-contain bg-muted/30";

/** Compact thumb beside candidate/result titles (~2× body text height). */
export const PHOTO_INLINE_THUMB_CLASS =
  "block h-8 w-8 max-h-8 max-w-8 shrink-0 rounded-md border object-cover bg-muted/30";

type PhotoCandidateImageProps = {
  src: string;
  alt: string;
  className?: string;
  /** When true (default), tap/click opens a fullscreen lightbox. */
  expandable?: boolean;
  /** Called when the image fails to load (e.g. fall back to a link). */
  onError?: () => void;
  /** Inline sits on the title row; block is a full-width preview. */
  layout?: "block" | "inline";
  /**
   * Anything attachment preview (wizard / nominate): capped height so Safari
   * does not show the full-resolution file.
   */
  attachmentPreview?: boolean;
};

/** Renders a nominated contest photo; optional tap-to-expand lightbox. */
export function PhotoCandidateImage({
  src,
  alt,
  className,
  expandable = true,
  onError,
  layout = "block",
  attachmentPreview = false,
}: PhotoCandidateImageProps) {
  const [open, setOpen] = useState(false);
  const resolvedClass =
    className ??
    (layout === "inline" ? PHOTO_INLINE_THUMB_CLASS : PHOTO_LIST_PREVIEW_CLASS);

  const image = (
    // eslint-disable-next-line @next/next/no-img-element -- remote Supabase storage URLs
    <img
      src={src}
      alt={alt}
      width={layout === "inline" ? 32 : undefined}
      height={layout === "inline" ? 32 : undefined}
      className={cn(resolvedClass, expandable && "cursor-zoom-in")}
      style={
        layout === "inline"
          ? undefined
          : attachmentPreview
            ? // Safari often ignores max-h on replaced elements without an explicit cap.
              { maxHeight: 160 }
            : undefined
      }
      loading="lazy"
      onError={onError}
    />
  );

  if (!expandable) {
    return image;
  }

  return (
    <>
      <button
        type="button"
        className={cn(
          "rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          layout === "inline"
            ? "inline-flex size-8 shrink-0 items-center justify-center overflow-hidden p-0"
            : attachmentPreview
              ? "inline-flex max-h-40 max-w-full items-center justify-center overflow-hidden p-0"
              : "flex w-full justify-center rounded-lg",
        )}
        onClick={() => setOpen(true)}
        aria-label={`View full size: ${alt}`}
      >
        {image}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton
          className={cn(
            "fixed inset-0 top-0 left-0 z-50 flex h-dvh w-screen max-w-none",
            "translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden",
            "rounded-none border-0 bg-black p-3 text-white ring-0",
            "sm:max-w-none data-open:zoom-in-100 data-closed:zoom-out-100",
          )}
        >
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <DialogDescription className="sr-only">
            Full-size photo preview. Press Escape or use the close button to
            dismiss.
          </DialogDescription>
          {/* eslint-disable-next-line @next/next/no-img-element -- remote Supabase storage URLs */}
          <img
            src={src}
            alt={alt}
            className="mx-auto h-full w-full object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Anything / generic candidate URL: expandable thumbnail when the URL is an
 * image (including contest-photos uploads); otherwise a normal outbound link.
 * Unknown http(s) URLs are probed once so extension-less image CDNs still work.
 */
export function CandidateUrlPreview({
  url,
  alt,
  className,
  layout = "block",
}: {
  url: string;
  alt: string;
  className?: string;
  layout?: "block" | "inline";
}) {
  const trimmed = url.trim();
  const knownImage = isContestImageUrl(trimmed);
  const [mode, setMode] = useState<"image" | "link">(
    knownImage ? "image" : "link",
  );
  const [probing, setProbing] = useState(
    () => !knownImage && /^https?:\/\//i.test(trimmed),
  );

  useEffect(() => {
    const nextKnown = isContestImageUrl(trimmed);
    setMode(nextKnown ? "image" : "link");
    setProbing(!nextKnown && /^https?:\/\//i.test(trimmed));
  }, [trimmed]);

  if (mode === "image") {
    return (
      <PhotoCandidateImage
        src={trimmed}
        alt={alt}
        className={className}
        layout={layout}
        onError={() => {
          setMode("link");
          setProbing(false);
        }}
      />
    );
  }

  // Inline title row: no thumb for non-image URLs (link can sit below).
  if (layout === "inline") {
    return probing ? (
      // eslint-disable-next-line @next/next/no-img-element -- probe whether URL is an image
      <img
        src={trimmed}
        alt=""
        className="hidden"
        onLoad={() => {
          setMode("image");
          setProbing(false);
        }}
        onError={() => setProbing(false)}
      />
    ) : null;
  }

  return (
    <>
      {probing ? (
        // eslint-disable-next-line @next/next/no-img-element -- probe whether URL is an image
        <img
          src={trimmed}
          alt=""
          className="hidden"
          onLoad={() => {
            setMode("image");
            setProbing(false);
          }}
          onError={() => setProbing(false)}
        />
      ) : null}
      <a
        href={trimmed}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-muted-foreground underline-offset-2 hover:underline break-all"
      >
        {trimmed}
      </a>
    </>
  );
}

/** Local File preview (wizard / nominate) with the same expandable thumbnail as live photos. */
export function LocalPhotoFilePreview({
  file,
  alt,
  className = PHOTO_ATTACHMENT_PREVIEW_CLASS,
}: {
  file: File;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!file.type.startsWith("image/")) {
      setSrc(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setSrc(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!src) return null;
  return (
    <PhotoCandidateImage
      src={src}
      alt={alt}
      className={className}
      attachmentPreview
    />
  );
}
