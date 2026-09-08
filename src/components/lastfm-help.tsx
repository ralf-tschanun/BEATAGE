"use client";

import { useEffect, useState } from "react";
import { QuestionIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BRAND_NAME } from "@/lib/brand";
import {
  isLastfmUserNotFoundMessage,
  LASTFM_USER_FOUND_MESSAGE,
  LASTFM_USER_NOT_FOUND_MESSAGE,
} from "@/lib/lastfm-messages";

const LOOKUP_DEBOUNCE_MS = 650;

export type LastfmUserLookupStatus =
  | "idle"
  | "checking"
  | "found"
  | "invalid"
  | "unavailable";

export async function lookupLastfmUserClient(
  username: string,
  signal?: AbortSignal,
): Promise<LastfmUserLookupStatus> {
  const user = username.trim().replace(/^@/, "");
  if (!user) return "idle";

  try {
    const response = await fetch(
      `/api/lastfm/user?user=${encodeURIComponent(user)}`,
      { cache: "no-store", signal },
    );
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      code?: string;
    } | null;
    if (data?.ok) return "found";
    if (data?.code === "invalid_user" || response.status === 404) {
      return "invalid";
    }
    return "unavailable";
  } catch (error) {
    if (signal?.aborted) return "checking";
    if (error instanceof DOMException && error.name === "AbortError") {
      return "checking";
    }
    return "unavailable";
  }
}

/** Returns the not-found message, or null if the user exists / lookup is unavailable. */
export async function ensureLastfmUserExists(
  username: string,
): Promise<string | null> {
  const status = await lookupLastfmUserClient(username);
  return status === "invalid" ? LASTFM_USER_NOT_FOUND_MESSAGE : null;
}

export function useLastfmUserLookup(
  username: string,
  enabled = true,
): LastfmUserLookupStatus {
  const [status, setStatus] = useState<LastfmUserLookupStatus>("idle");

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }
    const user = username.trim().replace(/^@/, "");
    if (!user) {
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    setStatus("checking");
    const timer = window.setTimeout(() => {
      void lookupLastfmUserClient(user, controller.signal).then((next) => {
        if (!controller.signal.aborted) setStatus(next);
      });
    }, LOOKUP_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [enabled, username]);

  return status;
}

export function LastfmHelpButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="size-6 shrink-0 text-muted-foreground"
      aria-label="Why Last.fm?"
      onClick={onClick}
    >
      <QuestionIcon className="size-4" weight="bold" />
    </Button>
  );
}

export function LastfmUserFoundNotice() {
  return (
    <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">
      {LASTFM_USER_FOUND_MESSAGE}
    </p>
  );
}

export function LastfmUserNotFoundAlert({
  onHelp,
}: {
  onHelp: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5" role="alert">
      <p className="text-sm text-destructive">{LASTFM_USER_NOT_FOUND_MESSAGE}</p>
      <LastfmHelpButton onClick={onHelp} />
    </div>
  );
}

export function LastfmErrorAlert({
  error,
  onHelp,
}: {
  error: string | null;
  onHelp: () => void;
}) {
  if (!error) return null;
  if (isLastfmUserNotFoundMessage(error)) {
    return <LastfmUserNotFoundAlert onHelp={onHelp} />;
  }
  return (
    <p className="text-sm text-destructive" role="alert">
      {error}
    </p>
  );
}

export function LastfmHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Why Last.fm?</DialogTitle>
          <DialogDescription>
            {BRAND_NAME} needs Last.fm to detect which track is currently playing
            on Spotify, so quiz rounds can open automatically.
          </DialogDescription>
        </DialogHeader>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            Create a free{" "}
            <a
              href="https://www.last.fm/join"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline-offset-2 hover:underline"
            >
              Last.fm account
            </a>{" "}
            if you do not have one yet.
          </li>
          <li>
            On the Last.fm website, scroll to the bottom and open{" "}
            <strong className="font-medium text-foreground">ACCOUNT → Settings → Applications</strong>.
            Under <strong className="font-medium text-foreground">Spotify Scrobbling</strong>, click{" "}
            <strong className="font-medium text-foreground">Connect</strong> and authorize Spotify.
          </li>
          <li>Enter your Last.fm username here.</li>
        </ol>
        <p className="text-sm text-muted-foreground">
          The ACCOUNT link is at the very bottom of the Last.fm page — easy to miss.
        </p>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
