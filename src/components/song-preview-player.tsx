"use client";

import { useEffect, useRef, useState } from "react";
import {
  PauseIcon,
  PlayIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
} from "@phosphor-icons/react";
import {
  getEffectivePreviewVolume,
  initPreviewAudioSettings,
  setPreviewVolume,
  usePreviewAudioSettings,
} from "@/lib/preview-audio";
import { cn } from "@/lib/utils";

type SongPreviewPlayerProps = {
  previewUrl: string;
  label?: string;
  className?: string;
};

let activeAudio: HTMLAudioElement | null = null;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function readDuration(audio: HTMLAudioElement): number {
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    return audio.duration;
  }
  try {
    if (audio.seekable.length > 0) {
      const end = audio.seekable.end(audio.seekable.length - 1);
      if (Number.isFinite(end) && end > 0) return end;
    }
  } catch {
    // ignore
  }
  return 0;
}

export function SongPreviewPlayer({
  previewUrl,
  label,
  className,
}: SongPreviewPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const volumePanelRef = useRef<HTMLDivElement | null>(null);
  const seekingRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const { volume, muted } = usePreviewAudioSettings();

  useEffect(() => {
    initPreviewAudioSettings();
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.pause();
    audio.currentTime = 0;
    seekingRef.current = false;
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setVolumeOpen(false);
    if (activeAudio === audio) activeAudio = null;
  }, [previewUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = getEffectivePreviewVolume();
  }, [volume, muted]);

  useEffect(() => {
    if (!volumeOpen) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (volumePanelRef.current && target && !volumePanelRef.current.contains(target)) {
        setVolumeOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [volumeOpen]);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    function tick() {
      const audio = audioRef.current;
      if (audio && !seekingRef.current) {
        setCurrent(audio.currentTime || 0);
        const nextDuration = readDuration(audio);
        if (nextDuration > 0) setDuration(nextDuration);
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [playing]);

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio && activeAudio === audio) {
        audio.pause();
        activeAudio = null;
      }
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  function syncDurationFromAudio(audio: HTMLAudioElement) {
    const next = readDuration(audio);
    if (next > 0) setDuration(next);
  }

  function seekTo(next: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const max = readDuration(audio) || duration;
    const clamped = Math.min(Math.max(0, next), max || next);
    audio.currentTime = clamped;
    setCurrent(clamped);
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;

    if (playing) {
      audio.pause();
      return;
    }

    if (activeAudio && activeAudio !== audio) {
      activeAudio.pause();
    }
    activeAudio = audio;
    audio.volume = getEffectivePreviewVolume();
    syncDurationFromAudio(audio);
    void audio.play().catch(() => {
      setPlaying(false);
    });
  }

  const sliderMax = duration > 0 ? duration : 1;
  const sliderValue = duration > 0 ? Math.min(current, duration) : 0;

  return (
    <div className={cn("mt-1.5 inline-flex max-w-full flex-col gap-1", className)}>
      {label ? (
        <p className="text-xs text-muted-foreground">{label}</p>
      ) : null}
      <div className="relative inline-flex h-8 w-full max-w-md items-center gap-1 rounded-md border bg-muted/30 px-1">
        <audio
          ref={audioRef}
          preload="auto"
          src={previewUrl}
          onLoadedMetadata={(event) => {
            syncDurationFromAudio(event.currentTarget);
            event.currentTarget.volume = getEffectivePreviewVolume();
          }}
          onDurationChange={(event) => {
            syncDurationFromAudio(event.currentTarget);
          }}
          onCanPlay={(event) => {
            syncDurationFromAudio(event.currentTarget);
          }}
          onTimeUpdate={(event) => {
            if (seekingRef.current) return;
            setCurrent(event.currentTarget.currentTime || 0);
            syncDurationFromAudio(event.currentTarget);
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setCurrent(0);
            if (activeAudio === audioRef.current) activeAudio = null;
          }}
        />

        <button
          type="button"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-muted"
          onClick={togglePlay}
          aria-label={playing ? "Pause preview" : "Play preview"}
        >
          {playing ? (
            <PauseIcon className="size-3.5" />
          ) : (
            <PlayIcon className="size-3.5" />
          )}
        </button>

        <span className="min-w-[3.5rem] shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatTime(current)}
          {duration > 0 ? `/${formatTime(duration)}` : ""}
        </span>

        <input
          type="range"
          min={0}
          max={sliderMax}
          step={0.05}
          value={sliderValue}
          disabled={duration <= 0}
          aria-label="Seek preview"
          className="h-1.5 min-w-[4rem] flex-1 cursor-pointer accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
          onPointerDown={() => {
            seekingRef.current = true;
          }}
          onPointerUp={(event) => {
            seekTo(Number(event.currentTarget.value));
            seekingRef.current = false;
          }}
          onPointerCancel={() => {
            seekingRef.current = false;
          }}
          onInput={(event) => {
            seekingRef.current = true;
            setCurrent(Number(event.currentTarget.value));
          }}
          onChange={(event) => {
            seekTo(Number(event.currentTarget.value));
          }}
        />

        <div ref={volumePanelRef} className="relative shrink-0">
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted"
            onClick={() => setVolumeOpen((open) => !open)}
            aria-label="Volume"
            aria-expanded={volumeOpen}
          >
            {muted || volume === 0 ? (
              <SpeakerSlashIcon className="size-3.5" />
            ) : (
              <SpeakerHighIcon className="size-3.5" />
            )}
          </button>

          {volumeOpen ? (
            <div className="absolute top-full right-0 z-20 mt-1 flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 shadow-sm">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                aria-label="Volume level"
                className="h-1.5 w-24 accent-foreground"
                onChange={(event) => {
                  setPreviewVolume(Number(event.target.value));
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
