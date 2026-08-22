"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PHOTO_LIST_PREVIEW_CLASS } from "@/components/photo-candidate-image";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ALLOWED_CONTEST_PHOTO_TYPES,
  prepareContestPhotoForUpload,
} from "@/lib/contest-photos";
import { cn } from "@/lib/utils";

export type PhotoPickValue = {
  /** Local file selected for upload (null when keeping an existing photo). */
  file: File | null;
  caption: string;
  /** Existing remote URL when editing. */
  existingUrl: string | null;
};

type PhotoPickFieldsProps = {
  idPrefix?: string;
  value: PhotoPickValue;
  onChange: (value: PhotoPickValue) => void;
  /** When true, a new file is required (nominate). When false, existing URL may stay. */
  requireNewFile?: boolean;
  /** e.g. "Photo 3" when nominating the 3rd photo. */
  fileLabel?: string;
};

export function PhotoPickFields({
  idPrefix = "photo",
  value,
  onChange,
  requireNewFile = true,
  fileLabel = "Photo",
}: PhotoPickFieldsProps) {
  const generatedId = useId();
  // Stable id for nominate remounts so we can refocus after a successful submit.
  const inputId =
    idPrefix === "nominate" ? "nominate-photo-file" : `${idPrefix}-file-${generatedId}`;
  const captionId =
    idPrefix === "nominate"
      ? "nominate-photo-caption"
      : `${idPrefix}-caption-${generatedId}`;
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const pickGenerationRef = useRef(0);

  useEffect(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (value.file) {
      const url = URL.createObjectURL(value.file);
      objectUrlRef.current = url;
      setLocalPreview(url);
    } else {
      setLocalPreview(null);
    }
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [value.file]);

  const previewSrc = localPreview ?? value.existingUrl;
  const accept = ALLOWED_CONTEST_PHOTO_TYPES.join(",");

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={inputId}>{fileLabel}</Label>
        <label
          htmlFor={inputId}
          className={cn(
            "inline-flex cursor-pointer items-center justify-center rounded-lg border border-input px-3 py-2 text-sm",
            "bg-background hover:bg-muted/60",
            compressing && "pointer-events-none opacity-60",
          )}
        >
          {compressing ? "Compressing…" : "Select a photo"}
          <input
            id={inputId}
            name="photo"
            type="file"
            accept={accept}
            required={requireNewFile && !value.existingUrl}
            disabled={compressing}
            className="sr-only"
            onChange={(event) => {
              const input = event.currentTarget;
              const file = input.files?.[0] ?? null;
              input.value = "";
              setPickError(null);
              if (!file) {
                onChange({ ...value, file: null });
                return;
              }
              const generation = ++pickGenerationRef.current;
              setCompressing(true);
              void prepareContestPhotoForUpload(file).then((prepared) => {
                if (generation !== pickGenerationRef.current) return;
                setCompressing(false);
                if ("error" in prepared) {
                  setPickError(prepared.error);
                  onChange({ ...value, file: null });
                  return;
                }
                onChange({ ...value, file: prepared });
              });
            }}
          />
        </label>
        {pickError ? (
          <p className="text-sm text-destructive" role="alert">
            {pickError}
          </p>
        ) : null}
      </div>

      {previewSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- contest upload preview / remote storage URL
        <img
          src={previewSrc}
          alt={value.caption.trim() || "Selected photo"}
          className={PHOTO_LIST_PREVIEW_CLASS}
        />
      ) : null}

      {value.existingUrl ? (
        <input type="hidden" name="url" value={value.existingUrl} />
      ) : null}

      <div className="space-y-2">
        <Label htmlFor={captionId}>Caption (optional)</Label>
        <Input
          id={captionId}
          name="title"
          value={value.caption}
          onChange={(event) =>
            onChange({ ...value, caption: event.target.value })
          }
          placeholder="Photo"
          maxLength={120}
        />
      </div>
    </div>
  );
}
