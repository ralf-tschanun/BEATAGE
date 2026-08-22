"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QrCodeIcon } from "@phosphor-icons/react";
import jsQRImport from "jsqr";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { joinCodeFromQrPayload } from "@/lib/join-code-from-qr";

type QrCodeScannerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCode: (joinCode: string) => void;
  /** Pass a stream obtained in the same user gesture (required on iOS Safari). */
  initialStream?: MediaStream | null;
};

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

type JsQRFn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst";
  },
) => { data: string } | null;

// Turbopack / CJS interop — never rely on dynamic import().default alone.
const jsQR: JsQRFn =
  (jsQRImport as unknown as { default?: JsQRFn }).default ?? jsQRImport;

function getBarcodeDetector(): BarcodeDetectorLike | null {
  const Ctor = (
    globalThis as unknown as {
      BarcodeDetector?: new (options?: {
        formats: string[];
      }) => BarcodeDetectorLike;
    }
  ).BarcodeDetector;
  if (!Ctor) return null;
  try {
    return new Ctor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

function createOffscreenCanvas(): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} | null {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  return { canvas, ctx };
}

async function waitForVideoFrames(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Camera preview timed out."));
    }, 12_000);

    const tryResolve = () => {
      if (video.videoWidth > 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        cleanup();
        resolve();
      }
    };

    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadeddata", tryResolve);
      video.removeEventListener("playing", tryResolve);
      video.removeEventListener("resize", tryResolve);
    };

    video.addEventListener("loadeddata", tryResolve);
    video.addEventListener("playing", tryResolve);
    video.addEventListener("resize", tryResolve);
    tryResolve();
  });
}

function decodeVideoFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
): string | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw < 8 || vh < 8) return null;

  const shortSide = Math.min(vw, vh);
  const cropFractions = [1, 0.75, 0.55];
  const maxOut = 1024;

  for (const fraction of cropFractions) {
    const side = Math.max(8, Math.round(shortSide * fraction));
    const sx = Math.floor((vw - side) / 2);
    const sy = Math.floor((vh - side) / 2);
    const out = Math.min(maxOut, side);
    canvas.width = out;
    canvas.height = out;
    ctx.imageSmoothingEnabled = side > out;
    ctx.drawImage(video, sx, sy, side, side, 0, 0, out, out);
    const image = ctx.getImageData(0, 0, out, out);
    const result = jsQR(image.data, out, out, {
      inversionAttempts: "attemptBoth",
    });
    const raw = result?.data?.trim();
    if (raw) return raw;
  }

  const scale = Math.min(1, maxOut / Math.max(vw, vh));
  const outW = Math.max(8, Math.round(vw * scale));
  const outH = Math.max(8, Math.round(vh * scale));
  canvas.width = outW;
  canvas.height = outH;
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(video, 0, 0, vw, vh, 0, 0, outW, outH);
  const full = ctx.getImageData(0, 0, outW, outH);
  const result = jsQR(full.data, outW, outH, { inversionAttempts: "attemptBoth" });
  return result?.data?.trim() ?? null;
}

async function openCameraStream(
  initialStream?: MediaStream | null,
): Promise<MediaStream> {
  if (initialStream?.active) return initialStream;
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });
}

export function QrCodeScanner({
  open,
  onOpenChange,
  onCode,
  initialStream = null,
}: QrCodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ownsStreamRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const handledRef = useRef(false);
  const lastInvalidRawRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const stopCamera = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream && ownsStreamRef.current) {
      for (const track of stream.getTracks()) track.stop();
    }
    ownsStreamRef.current = false;
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }
  }, []);

  const handleDetected = useCallback(
    (raw: string) => {
      if (handledRef.current) return;
      const code = joinCodeFromQrPayload(raw);
      if (!code) {
        if (lastInvalidRawRef.current !== raw) {
          lastInvalidRawRef.current = raw;
          setError("That QR code is not a BEATAGE invite. Try again.");
        }
        return;
      }
      handledRef.current = true;
      stopCamera();
      onOpenChange(false);
      onCode(code);
    },
    [onCode, onOpenChange, stopCamera],
  );

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }

    let cancelled = false;
    handledRef.current = false;
    lastInvalidRawRef.current = null;
    setError(null);
    setStarting(true);

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Camera access is not supported in this browser.");
        setStarting(false);
        return;
      }

      const offscreen = createOffscreenCanvas();
      if (!offscreen) {
        setError("Could not initialize the QR scanner.");
        setStarting(false);
        return;
      }
      const { canvas, ctx } = offscreen;

      try {
        // Dialog content mounts after open=true — wait for the video element.
        let video = videoRef.current;
        for (let i = 0; i < 40 && !video; i += 1) {
          await new Promise((r) => setTimeout(r, 50));
          if (cancelled) return;
          video = videoRef.current;
        }
        if (!video) {
          setError("Camera preview failed to start.");
          setStarting(false);
          return;
        }

        const stream = await openCameraStream(initialStream);
        if (cancelled) {
          if (!initialStream || stream !== initialStream) {
            for (const track of stream.getTracks()) track.stop();
          }
          return;
        }

        streamRef.current = stream;
        ownsStreamRef.current = !initialStream;

        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        video.setAttribute("webkit-playsinline", "true");
        video.muted = true;
        await video.play();
        await waitForVideoFrames(video);
        if (cancelled) return;

        setStarting(false);
        const detector = getBarcodeDetector();
        let lastScanAt = 0;

        const tick = () => {
          if (cancelled || handledRef.current) return;
          const v = videoRef.current;
          if (!v || v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || v.videoWidth < 8) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }

          const now = performance.now();
          if (now - lastScanAt >= 120) {
            lastScanAt = now;
            try {
              const raw = decodeVideoFrame(ctx, canvas, v);
              if (raw) {
                handleDetected(raw);
                return;
              }
            } catch {
              // Keep scanning.
            }

            if (detector) {
              void detector.detect(v).then((codes) => {
                if (cancelled || handledRef.current) return;
                const value = codes[0]?.rawValue?.trim();
                if (value) handleDetected(value);
              });
            }
          }

          rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        if (cancelled) return;
        setStarting(false);
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          setError("Camera permission denied. Allow camera access and try again.");
        } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
          setError("No camera was found on this device.");
        } else {
          setError("Could not open the camera. Try again or enter the code manually.");
        }
      }
    }

    void start();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, initialStream, handleDetected, stopCamera]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) stopCamera();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Scan invite QR code</DialogTitle>
          <DialogDescription>
            Point your camera at a BEATAGE invite QR code. You stay in this
            browser session.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-2xl bg-black aspect-[3/4] sm:aspect-video">
            <video
              ref={videoRef}
              className="size-full object-cover"
              playsInline
              muted
              autoPlay
            />
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              aria-hidden
            >
              <div className="size-[min(70%,14rem)] rounded-2xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
            {starting ? (
              <p className="absolute inset-0 flex items-center justify-center text-sm text-white/90">
                Starting camera…
              </p>
            ) : null}
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Tip: fill the frame with the QR code and hold steady.
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => {
              stopCamera();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ScanQrCodeButtonProps = {
  onCode: (joinCode: string) => void;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
  size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";
  className?: string;
  label?: string;
};

export function ScanQrCodeButton({
  onCode,
  variant = "secondary",
  size = "lg",
  className,
  label = "Scan invite QR code",
}: ScanQrCodeButtonProps) {
  const [open, setOpen] = useState(false);
  const [pendingStream, setPendingStream] = useState<MediaStream | null>(null);
  const pendingStreamRef = useRef<MediaStream | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  function releasePendingStream() {
    const stream = pendingStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    pendingStreamRef.current = null;
    setPendingStream(null);
  }

  async function handleOpenScanner() {
    setLaunchError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setLaunchError("Camera access is not supported in this browser.");
      return;
    }

    try {
      // Request the camera in the click handler — iOS Safari requires the user gesture here.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      pendingStreamRef.current = stream;
      setPendingStream(stream);
      setOpen(true);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setLaunchError("Camera permission denied. Allow camera access and try again.");
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setLaunchError("No camera was found on this device.");
      } else {
        setLaunchError("Could not open the camera. Try again or enter the code manually.");
      }
    }
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => void handleOpenScanner()}
      >
        <QrCodeIcon data-icon="inline-start" weight="duotone" />
        {label}
      </Button>
      {launchError && !open ? (
        <p className="text-sm text-destructive" role="alert">
          {launchError}
        </p>
      ) : null}
      <QrCodeScanner
        open={open}
        initialStream={pendingStream}
        onOpenChange={(next) => {
          if (!next) releasePendingStream();
          setOpen(next);
        }}
        onCode={onCode}
      />
    </>
  );
}
