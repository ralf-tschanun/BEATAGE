"use client";

import { useActionState, useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PaperclipIcon, XIcon } from "@phosphor-icons/react";
import {
  updateCandidateAction,
  withdrawCandidateAction,
  type ContestActionState,
} from "@/app/actions/contest";
import { SongPickFields, type SongPickValue } from "@/components/song-pick-fields";
import { PhotoPickFields, type PhotoPickValue } from "@/components/photo-pick-fields";
import {
  LocalPhotoFilePreview,
  PhotoCandidateImage,
  PHOTO_ATTACHMENT_PREVIEW_CLASS,
} from "@/components/photo-candidate-image";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isContestImageUrl, prepareContestPhotoForUpload } from "@/lib/contest-photos";
import type { ContestTheme } from "@/lib/plans";
import { cn } from "@/lib/utils";

const initialState: ContestActionState = null;

export type EditableCandidate = {
  id: string;
  title: string;
  artist: string | null;
  url: string | null;
  description: string | null;
  deletePhotoOnFinish?: boolean;
};

type EditCandidateControlsProps = {
  candidate: EditableCandidate;
  joinCode: string;
  contestId: string;
  theme: ContestTheme;
};

export function EditCandidateControls({
  candidate,
  joinCode,
  contestId,
  theme,
}: EditCandidateControlsProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  const [updateState, updateAction, updatePending] = useActionState(
    updateCandidateAction,
    initialState,
  );
  const [withdrawState, withdrawAction, withdrawPending] = useActionState(
    withdrawCandidateAction,
    initialState,
  );

  const [song, setSong] = useState<SongPickValue>({
    title: candidate.title,
    artist: candidate.artist ?? "",
    previewUrl: candidate.url ?? "",
  });
  const [photo, setPhoto] = useState<PhotoPickValue>({
    file: null,
    caption: candidate.title === "Photo" ? "" : candidate.title,
    existingUrl: candidate.url,
  });
  const [title, setTitle] = useState(candidate.title);
  const [url, setUrl] = useState(candidate.url ?? "");
  const [description, setDescription] = useState(candidate.description ?? "");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [deletePhotoOnFinish, setDeletePhotoOnFinish] = useState(
    candidate.deletePhotoOnFinish === true,
  );

  useEffect(() => {
    if (!editOpen) return;
    setSong({
      title: candidate.title,
      artist: candidate.artist ?? "",
      previewUrl: candidate.url ?? "",
    });
    setPhoto({
      file: null,
      caption: candidate.title === "Photo" ? "" : candidate.title,
      existingUrl: candidate.url,
    });
    setTitle(candidate.title);
    setUrl(candidate.url ?? "");
    setDescription(candidate.description ?? "");
    setAttachment(null);
    setAttachError(null);
    setDetailsOpen(
      Boolean(candidate.url?.trim()) || Boolean(candidate.description?.trim()),
    );
    setDeletePhotoOnFinish(candidate.deletePhotoOnFinish === true);
  }, [editOpen, candidate]);

  useEffect(() => {
    if (!updateState?.success && !withdrawState?.success) return;
    setEditOpen(false);
    setConfirmWithdraw(false);
    router.refresh();
  }, [updateState?.success, withdrawState?.success, router]);

  const hasExtras =
    Boolean(url.trim()) || Boolean(description.trim()) || Boolean(attachment);
  const showDetails = detailsOpen || hasExtras;
  const existingImageUrl =
    !attachment && isContestImageUrl(url) ? url.trim() : null;

  function handleGenericSubmit(event: FormEvent<HTMLFormElement>) {
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
      updateAction(fd);
    });
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
        Edit
      </Button>
      {!confirmWithdraw ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setConfirmWithdraw(true)}
        >
          Remove
        </Button>
      ) : (
        <form action={withdrawAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="candidateId" value={candidate.id} />
          <input type="hidden" name="joinCode" value={joinCode} />
          <span className="text-xs text-destructive">Remove this nomination?</span>
          <Button type="submit" variant="destructive" size="sm" disabled={withdrawPending}>
            {withdrawPending ? "Removing…" : "Yes, remove"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={withdrawPending}
            onClick={() => setConfirmWithdraw(false)}
          >
            Cancel
          </Button>
          {withdrawState?.error ? (
            <p className="w-full text-sm text-destructive" role="alert">
              {withdrawState.error}
            </p>
          ) : null}
        </form>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {theme === "generic" ? (
            <form onSubmit={handleGenericSubmit} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>Edit nomination</DialogTitle>
                <DialogDescription>
                  You can change this while nominations are still open.
                </DialogDescription>
              </DialogHeader>

              <input type="hidden" name="candidateId" value={candidate.id} />
              <input type="hidden" name="contestId" value={contestId} />
              <input type="hidden" name="joinCode" value={joinCode} />
              <input type="hidden" name="theme" value={theme} />

              <div className="space-y-2 rounded-lg border p-3">
                <Label htmlFor={`edit-title-${candidate.id}`}>Title</Label>
                <Input
                  id={`edit-title-${candidate.id}`}
                  name="title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Type a candidate…"
                  required
                  maxLength={120}
                  autoComplete="off"
                />

                {showDetails ? (
                  <div className="space-y-2">
                    <Input
                      id={`edit-url-${candidate.id}`}
                      name="url"
                      type="url"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="Link (optional)"
                      maxLength={500}
                    />
                    <Input
                      id={`edit-note-${candidate.id}`}
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
                          disabled={updatePending}
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
                            disabled={updatePending}
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
                        alt={title.trim() || "Candidate"}
                      />
                    ) : existingImageUrl ? (
                      <PhotoCandidateImage
                        src={existingImageUrl}
                        alt={title.trim() || "Candidate"}
                        className={PHOTO_ATTACHMENT_PREVIEW_CLASS}
                        attachmentPreview
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

              {updateState?.error ? (
                <p className="text-sm text-destructive" role="alert">
                  {updateState.error}
                </p>
              ) : null}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={updatePending}
                  onClick={() => setEditOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={updatePending || !title.trim()}>
                  {updatePending ? "Saving…" : "Save changes"}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <form action={updateAction} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>Edit nomination</DialogTitle>
                <DialogDescription>
                  You can change this while nominations are still open.
                </DialogDescription>
              </DialogHeader>

              <input type="hidden" name="candidateId" value={candidate.id} />
              <input type="hidden" name="contestId" value={contestId} />
              <input type="hidden" name="joinCode" value={joinCode} />
              <input type="hidden" name="theme" value={theme} />

              {theme === "song" ? (
                <>
                  <input type="hidden" name="title" value={song.title} />
                  <input type="hidden" name="artist" value={song.artist} />
                  <input type="hidden" name="url" value={song.previewUrl} />
                  <SongPickFields
                    idPrefix={`edit-${candidate.id}`}
                    value={song}
                    onChange={setSong}
                    searchLabel="Search song"
                    compact
                  />
                </>
              ) : (
                <>
                  <input
                    type="hidden"
                    name="deletePhotoOnFinish"
                    value={deletePhotoOnFinish ? "true" : "false"}
                  />
                  <PhotoPickFields
                    idPrefix={`edit-${candidate.id}`}
                    value={photo}
                    onChange={setPhoto}
                    requireNewFile={false}
                  />
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1 size-4"
                      checked={deletePhotoOnFinish}
                      onChange={(event) =>
                        setDeletePhotoOnFinish(event.target.checked)
                      }
                    />
                    <span>
                      Delete photo when contest has finished. The image is removed
                      so it cannot be viewed later in past contests.
                    </span>
                  </label>
                </>
              )}

              {updateState?.error ? (
                <p className="text-sm text-destructive" role="alert">
                  {updateState.error}
                </p>
              ) : null}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={updatePending}
                  onClick={() => setEditOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    updatePending ||
                    (theme === "song"
                      ? !song.title.trim() || !song.artist.trim()
                      : !photo.file && !photo.existingUrl)
                  }
                >
                  {updatePending ? "Saving…" : "Save changes"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
