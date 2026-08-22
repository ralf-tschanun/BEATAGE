"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "beatage.preview-volume";
const DEFAULT_VOLUME = 0.85;

type Listener = () => void;
type PreviewAudioSnapshot = {
  volume: number;
  muted: boolean;
};

let volume = DEFAULT_VOLUME;
let muted = false;
let snapshot: PreviewAudioSnapshot = { volume, muted };
const listeners = new Set<Listener>();

function emit() {
  snapshot = { volume, muted };
  for (const listener of listeners) listener();
}

function readStoredVolume(): number {
  if (typeof window === "undefined") return DEFAULT_VOLUME;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return DEFAULT_VOLUME;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_VOLUME;
    return Math.min(1, Math.max(0, parsed));
  } catch {
    return DEFAULT_VOLUME;
  }
}

function persistVolume(next: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // ignore quota / private mode
  }
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return snapshot;
}

const serverSnapshot: PreviewAudioSnapshot = {
  volume: DEFAULT_VOLUME,
  muted: false,
};

function getServerSnapshot() {
  return serverSnapshot;
}

let initialized = false;

export function initPreviewAudioSettings() {
  if (initialized) return;
  initialized = true;
  volume = readStoredVolume();
  muted = volume === 0;
  snapshot = { volume, muted };
  emit();
}

export function setPreviewVolume(next: number) {
  const clamped = Math.min(1, Math.max(0, next));
  volume = clamped;
  muted = clamped === 0;
  persistVolume(clamped);
  emit();
}

export function getEffectivePreviewVolume() {
  return muted ? 0 : volume;
}

export function usePreviewAudioSettings() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
