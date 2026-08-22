"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PaperclipIcon, XIcon } from "@phosphor-icons/react";
import {
  nominateCandidateAction,
  type ContestActionState,
} from "@/app/actions/contest";
import { SongPickFields, type SongPickValue } from "@/components/song-pick-fields";
import { PhotoPickFields, type PhotoPickValue } from "@/components/photo-pick-fields";
import { LocalPhotoFilePreview } from "@/components/photo-candidate-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { scrollToSection } from "@/lib/scroll";
import { broadcastContestResync } from "@/components/contest-live-refresh";
import { prepareContestPhotoForUpload } from "@/lib/contest-photos";
import type { ContestTheme, SongLinksMode } from "@/lib/plans";
import { cn } from "@/lib/utils";

const initialState: ContestActionState = null;

type NominateCandidateFormProps = {
  contestId: string;
  joinCode: string;
  remainingNominations: number | null;
  /** 1-based index of this nomination (Search song 3, …). */
  nextNominationNumber?: number;
  theme?: ContestTheme;
  mode?: "user" | "curated";
  /** Noun for generic nomination fields, e.g. "Restaurant" → "Restaurant 1". */
  candidateTitleLabel?: string;
  /** Song contests: preview / spotify / none from contest settings. */
  songLinks?: SongLinksMode;
  /** Compact search like create-wizard (no separate title/artist fields). */
  compactSongPick?: boolean;
};

export function NominateCandidateForm({
  contestId,
  joinCode,
  remainingNominations,
  nextNominationNumber = 1,
  theme = "generic",
  mode = "user",
  candidateTitleLabel = "Candidate",
  songLinks = "preview",
  compactSongPick = false,
}: NominateCandidateFormProps) {
  const [state, formAction, pending] = useActionState(
    nominateCandidateAction,
    initialState,
  );

  const blocked = remainingNominations !== null && remainingNominations <= 0;

  if (blocked) {
    return (
      <p className="text-sm text-muted-foreground">
        {mode === "curated"
          ? "This contest has reached its candidate limit. Edit or remove one above to free a slot."
          : "You have used all nominations for this contest. Edit or remove one below to free a slot."}
      </p>
    );
  }

  if (theme === "song") {
    return (
      <SongNominateForm
        contestId={contestId}
        joinCode={joinCode}
        submitLabel={mode === "curated" ? "Add song" : "Nominate song"}
        searchLabel={
          mode === "curated" || nextNominationNumber > 1
            ? `Search song ${nextNominationNumber}`
            : "Search song"
        }
        asCurated={mode === "curated"}
        songLinks={songLinks}
        compact={compactSongPick}
        formAction={formAction}
        pending={pending}
        state={state}
        nextNominationNumber={nextNominationNumber}
      />
    );
  }

  if (theme === "photo") {
    return (
      <PhotoNominateForm
        contestId={contestId}
        joinCode={joinCode}
        remainingNominations={remainingNominations}
        remainingLabel={mode === "curated" ? "Candidates left" : "Nominations left"}
        submitLabel={mode === "curated" ? "Add photo" : "Nominate photo"}
        photoLabel={`Photo ${nextNominationNumber}`}
        asCurated={mode === "curated"}
        formAction={formAction}
        pending={pending}
        state={state}
        nextNominationNumber={nextNominationNumber}
      />
    );
  }

  return (
    <GenericNominateForm
      contestId={contestId}
      joinCode={joinCode}
      remainingNominations={remainingNominations}
      nextNominationNumber={nextNominationNumber}
      candidateTitleLabel={candidateTitleLabel}
      mode={mode}
      formAction={formAction}
      pending={pending}
      state={state}
    />
  );
}

function useAfterNominateSuccess(
  contestId: string,
  state: ContestActionState,
  scrollToCandidates = true,
) {
  const router = useRouter();

  useEffect(() => {
    if (!state?.success) return;
    void broadcastContestResync(contestId);
    router.refresh();
    if (scrollToCandidates) {
      scrollToSection("contest-candidates");
    }
  }, [contestId, state, router, scrollToCandidates]);
}

/** Refocus the next nomination field after submit (refresh may lag behind). */
function focusNominateField(elementId: string) {
  function tryFocus() {
    const input = document.getElementById(elementId);
    if (
      !(
        input instanceof HTMLInputElement ||
        input instanceof HTMLTextAreaElement
      )
    ) {
      return false;
    }
    // Skip disabled / hidden file quirks — still focus so the next keypress lands here.
    input.focus({ preventScroll: true });
    input.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return document.activeElement === input;
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (tryFocus()) return;
      window.setTimeout(tryFocus, 50);
      window.setTimeout(tryFocus, 150);
      window.setTimeout(tryFocus, 350);
      window.setTimeout(tryFocus, 700);
    });
  });
}

/** When the next nomination index bumps after refresh, reclaim focus for rapid entry. */
function useRefocusWhenNominationNumberBumps(
  nextNominationNumber: number,
  elementId: string,
) {
  const previousNumberRef = useRef(nextNominationNumber);
  const isFirstRenderRef = useRef(true);

  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      previousNumberRef.current = nextNominationNumber;
      return;
    }
    if (nextNominationNumber <= previousNumberRef.current) {
      previousNumberRef.current = nextNominationNumber;
      return;
    }
    previousNumberRef.current = nextNominationNumber;
    focusNominateField(elementId);
  }, [nextNominationNumber, elementId]);
}

type GenericNominateFormProps = {
  contestId: string;
  joinCode: string;
  remainingNominations: number | null;
  nextNominationNumber: number;
  candidateTitleLabel: string;
  mode: "user" | "curated";
  formAction: (payload: FormData) => void;
  pending: boolean;
  state: ContestActionState;
};

function GenericNominateForm({
  contestId,
  joinCode,
  remainingNominations,
  nextNominationNumber,
  candidateTitleLabel,
  mode,
  formAction,
  pending,
  state,
}: GenericNominateFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  // Stay on the form so the host/participant can type the next candidate immediately.
  useAfterNominateSuccess(contestId, state, false);
  useRefocusWhenNominationNumberBumps(nextNominationNumber, "candidateTitle");

  useEffect(() => {
    if (!state?.success) return;
    setTitle("");
    setUrl("");
    setDescription("");
    setAttachment(null);
    setDetailsOpen(false);
    setAttachError(null);
    formRef.current?.reset();
    focusNominateField("candidateTitle");
  }, [state]);

  const hasExtras =
    Boolean(url.trim()) || Boolean(description.trim()) || Boolean(attachment);
  const showDetails = detailsOpen || hasExtras;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    fd.set("title", title.trim());
    fd.set("url", url.trim());
    fd.set("description", description.trim());
    if (attachment) {
      fd.set("attachment", attachment);
    } else {
      fd.delete("attachment");
    }
    startTransition(() => {
      formAction(fd);
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      <input type="hidden" name="contestId" value={contestId} />
      <input type="hidden" name="joinCode" value={joinCode} />
      <input type="hidden" name="theme" value="generic" />
      <input type="hidden" name="asCurated" value={mode === "curated" ? "true" : "false"} />

      <div className="space-y-2 rounded-lg border p-3">
        <Label htmlFor="candidateTitle">
          {candidateTitleLabel} {nextNominationNumber}
        </Label>
        <Input
          id="candidateTitle"
          name="title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={`Type a ${candidateTitleLabel.toLowerCase()}…`}
          required
          maxLength={120}
          autoComplete="off"
        />

        {showDetails ? (
          <div className="space-y-2">
            <Input
              id="candidateUrl"
              name="url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="Link (optional)"
              maxLength={500}
            />
            <Input
              id="candidateDescription"
              name="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Comment (optional)"
              maxLength={500}
            />
            <div className="flex flex-wrap items-center gap-2">
              <label
                className={cn(
                  "inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border border-input",
                  "bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
                title="Attach pic/file"
              >
                <PaperclipIcon className="size-4" weight="bold" />
                <span className="sr-only">Attach pic/file</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={pending}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    event.target.value = "";
                    if (!file) {
                      setAttachment(null);
                      setAttachError(null);
                      return;
                    }
                    void prepareContestPhotoForUpload(file).then((prepared) => {
                      if ("error" in prepared) {
                        setAttachError(prepared.error);
                        setAttachment(null);
                        return;
                      }
                      setAttachError(null);
                      setAttachment(prepared);
                    });
                  }}
                />
              </label>
              {attachment ? (
                <>
                  <span className="max-w-[12rem] truncate text-xs text-muted-foreground">
                    {attachment.name}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2"
                    disabled={pending}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setAttachment(null)}
                    aria-label="Remove attachment"
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Attach pic/file
                </span>
              )}
            </div>
            {attachError ? (
              <p className="text-sm text-destructive" role="alert">
                {attachError}
              </p>
            ) : null}
            {attachment ? (
              <LocalPhotoFilePreview
                file={attachment}
                alt={title.trim() || candidateTitleLabel}
              />
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setDetailsOpen(true)}
          >
            Add link, comment, or file
          </button>
        )}
      </div>

      {remainingNominations !== null ? (
        <p className="text-xs text-muted-foreground">
          {mode === "curated" ? "Candidates left" : "Nominations left"}:{" "}
          {remainingNominations}
        </p>
      ) : null}

      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      {state?.success ? (
        <p className="text-sm text-foreground" role="status">
          Candidate nominated.
        </p>
      ) : null}

      <Button type="submit" disabled={pending || !title.trim()}>
        {pending
          ? "Submitting…"
          : mode === "curated"
            ? "Add candidate"
            : "Nominate candidate"}
      </Button>
    </form>
  );
}

type SongNominateFormProps = {
  contestId: string;
  joinCode: string;
  submitLabel: string;
  searchLabel: string;
  asCurated: boolean;
  songLinks: SongLinksMode;
  compact: boolean;
  formAction: (payload: FormData) => void;
  pending: boolean;
  state: ContestActionState;
  nextNominationNumber: number;
};

function SongNominateForm({
  contestId,
  joinCode,
  submitLabel,
  searchLabel,
  asCurated,
  songLinks,
  compact,
  formAction,
  pending,
  state,
  nextNominationNumber,
}: SongNominateFormProps) {
  const [song, setSong] = useState<SongPickValue>({
    title: "",
    artist: "",
    previewUrl: "",
  });
  const [fieldsKey, setFieldsKey] = useState(0);
  useAfterNominateSuccess(contestId, state, !compact);
  useRefocusWhenNominationNumberBumps(nextNominationNumber, "nominate-search");

  useEffect(() => {
    if (!state?.success) return;
    setSong({ title: "", artist: "", previewUrl: "" });
    setFieldsKey((key) => key + 1);
    // Remount clears the search field — refocus so the next song can be typed immediately.
    focusNominateField("nominate-search");
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="contestId" value={contestId} />
      <input type="hidden" name="joinCode" value={joinCode} />
      <input type="hidden" name="theme" value="song" />
      <input type="hidden" name="asCurated" value={asCurated ? "true" : "false"} />
      <input type="hidden" name="title" value={song.title} />
      <input type="hidden" name="artist" value={song.artist} />
      <input type="hidden" name="url" value={song.previewUrl} />

      <SongPickFields
        key={fieldsKey}
        value={song}
        onChange={setSong}
        idPrefix="nominate"
        searchLabel={searchLabel}
        compact={compact}
        showPreview={songLinks !== "none"}
      />

      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      <Button
        type="submit"
        className="w-full"
        disabled={pending || !song.title.trim() || !song.artist.trim()}
      >
        {pending ? "Submitting…" : submitLabel}
      </Button>
    </form>
  );
}

type PhotoNominateFormProps = {
  contestId: string;
  joinCode: string;
  remainingNominations: number | null;
  remainingLabel: string;
  submitLabel: string;
  photoLabel: string;
  asCurated: boolean;
  formAction: (payload: FormData) => void;
  pending: boolean;
  state: ContestActionState;
  nextNominationNumber: number;
};

function PhotoNominateForm({
  contestId,
  joinCode,
  remainingNominations,
  remainingLabel,
  submitLabel,
  photoLabel,
  asCurated,
  formAction,
  pending,
  state,
  nextNominationNumber,
}: PhotoNominateFormProps) {
  const [photo, setPhoto] = useState<PhotoPickValue>({
    file: null,
    caption: "",
    existingUrl: null,
  });
  const [fieldsKey, setFieldsKey] = useState(0);
  useAfterNominateSuccess(contestId, state, false);
  useRefocusWhenNominationNumberBumps(nextNominationNumber, "nominate-photo-file");

  useEffect(() => {
    if (!state?.success) return;
    setPhoto({ file: null, caption: "", existingUrl: null });
    setFieldsKey((key) => key + 1);
    // File inputs are often sr-only — focus the visible “Select a photo” control via label.
    focusNominateField("nominate-photo-file");
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="contestId" value={contestId} />
      <input type="hidden" name="joinCode" value={joinCode} />
      <input type="hidden" name="theme" value="photo" />
      <input type="hidden" name="asCurated" value={asCurated ? "true" : "false"} />

      <PhotoPickFields
        key={fieldsKey}
        value={photo}
        onChange={setPhoto}
        idPrefix="nominate"
        requireNewFile
        fileLabel={photoLabel}
      />

      {remainingNominations !== null ? (
        <p className="text-xs text-muted-foreground">
          {remainingLabel}: {remainingNominations}
        </p>
      ) : null}

      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      {state?.success ? (
        <p className="text-sm text-foreground" role="status">
          Photo nominated.
        </p>
      ) : null}

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="deletePhotoOnFinish"
          value="true"
          className="mt-1 size-4"
          defaultChecked={false}
        />
        <span>
          Delete photo when contest has finished. The image is removed so it
          cannot be viewed later in past contests.
        </span>
      </label>

      <Button type="submit" disabled={pending || !photo.file}>
        {pending ? "Uploading…" : submitLabel}
      </Button>
    </form>
  );
}
