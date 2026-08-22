"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "beatage.collapsible-sections";

type SectionsState = Record<string, boolean>;
type Listener = () => void;

let state: SectionsState = {};
let hydrated = false;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

function readStored(): SectionsState {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const next: SectionsState = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "boolean") next[key] = value;
    }
    return next;
  } catch {
    return {};
  }
}

function persist(next: SectionsState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private mode
  }
}

function ensureHydrated() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  state = readStored();
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    state = readStored();
    emit();
  });
}

function subscribe(listener: Listener) {
  ensureHydrated();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  ensureHydrated();
  return state;
}

const serverSnapshot: SectionsState = {};

function getServerSnapshot() {
  return serverSnapshot;
}

export function setCollapsibleSectionOpen(sectionId: string, open: boolean) {
  ensureHydrated();
  if (state[sectionId] === open) return;
  state = { ...state, [sectionId]: open };
  persist(state);
  emit();
}

export function useCollapsibleSection(
  sectionId: string,
  defaultOpen: boolean,
): [boolean, (open: boolean | ((prev: boolean) => boolean)) => void] {
  const sections = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const open = sections[sectionId] ?? defaultOpen;

  function setOpen(next: boolean | ((prev: boolean) => boolean)) {
    const resolved = typeof next === "function" ? next(open) : next;
    setCollapsibleSectionOpen(sectionId, resolved);
  }

  return [open, setOpen];
}
