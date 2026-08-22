"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDownIcon, PlusIcon } from "@phosphor-icons/react";
import {
  castBallotAction,
  type ContestActionState,
} from "@/app/actions/contest";
import { broadcastContestResync } from "@/components/contest-live-refresh";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { VotingCountdown } from "@/components/voting-countdown";
import { PhotoCandidateImage } from "@/components/photo-candidate-image";
import {
  getBallotSlotCount,
  pointsForRank,
  type ContestTheme,
  type ScoringModelId,
} from "@/lib/plans";
import { formatPhotoLabel } from "@/lib/photo-labels";
import { isContestImageUrl } from "@/lib/contest-photos";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

const initialState: ContestActionState = null;

function candidateHasImage(
  theme: ContestTheme | undefined,
  url?: string | null,
): boolean {
  if (!url) return false;
  if (theme === "photo") return true;
  if (theme === "generic") return isContestImageUrl(url);
  return false;
}

export type BallotCandidate = {
  id: string;
  title: string;
  artist: string | null;
  url?: string | null;
  /** 1-based photo index for photo contests (stable for this ballot list). */
  photoNumber?: number;
  /** Anything contest: which question this candidate belongs to. */
  questionId?: string | null;
};

type VotingBallotProps = {
  contestId: string;
  joinCode: string;
  scoringModel: ScoringModelId;
  theme?: ContestTheme;
  candidates: BallotCandidate[];
  /** Candidate IDs that cannot be selected (e.g. own nominations). */
  excludedCandidateIds?: string[];
  existingRankings: string[] | null;
  locked: boolean;
  voteMutability: "editable_until_close" | "locked_on_submit";
  /** When false, only show the submitted ranking (e.g. after voting closed). */
  allowEdit?: boolean;
  /** ISO timestamp when voting closes (scheduled mode). */
  votingClosesAt?: string | null;
  /** Missed the deadline / never submitted after voting ended. */
  missedDeadline?: boolean;
  /** Anything contest: ballot is scoped to this question. */
  questionId?: string | null;
  questionTitle?: string | null;
  /** Hide topic title above the form (shown by a parent section instead). */
  hideQuestionTitle?: boolean;
  /** Hide the “Rank your top N…” helper copy. */
  hideIntro?: boolean;
};

function ballotCandidateLabel(
  candidate: BallotCandidate | undefined,
  theme?: ContestTheme,
): string {
  if (!candidate) return "Unknown";
  if (theme === "photo" && candidate.photoNumber != null) {
    return formatPhotoLabel(candidate.photoNumber, candidate.title);
  }
  return candidate.artist
    ? `${candidate.title} — ${candidate.artist}`
    : candidate.title;
}

function PhotoThumb({
  src,
  alt,
  size = "md",
  expandable = false,
}: {
  src?: string | null;
  alt: string;
  size?: "sm" | "md";
  /** When true, tap opens a fullscreen lightbox (with + affordance). */
  expandable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = size === "sm" ? "size-7" : "size-9";
  if (!src) {
    return (
      <span
        className={cn(box, "shrink-0 rounded border bg-muted/50")}
        aria-hidden
      />
    );
  }

  const image = (
    // eslint-disable-next-line @next/next/no-img-element -- remote Supabase storage URLs
    <img
      src={src}
      alt={alt}
      className={cn(box, "rounded border object-cover bg-muted/30")}
      loading="lazy"
    />
  );

  if (!expandable) {
    return <span className="relative shrink-0">{image}</span>;
  }

  return (
    <>
      <button
        type="button"
        className="relative shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        aria-label={`View full size: ${alt || "photo"}`}
      >
        {image}
        <span
          className="absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center rounded-full bg-foreground text-background shadow-sm"
          aria-hidden
        >
          <PlusIcon className="size-2.5" weight="bold" />
        </span>
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
          <DialogTitle className="sr-only">{alt || "Photo"}</DialogTitle>
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

/** Custom picker: native <option> cannot show images. */
function PhotoBallotSelect({
  id,
  value,
  candidates,
  usedIds,
  onChange,
  theme,
}: {
  id: string;
  value: string;
  candidates: BallotCandidate[];
  usedIds: Set<string>;
  onChange: (next: string) => void;
  theme?: ContestTheme;
}) {
  const [open, setOpen] = useState(false);
  const [menuBox, setMenuBox] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const selected = candidates.find((candidate) => candidate.id === value);

  useEffect(() => {
    if (!open) {
      setMenuBox(null);
      return;
    }

    function updatePosition() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const gap = 4;
      const preferredMax = 256;
      const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
      const spaceAbove = rect.top - gap - 8;
      const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(
        120,
        Math.min(preferredMax, openUp ? spaceAbove : spaceBelow),
      );
      setMenuBox({
        top: openUp ? undefined : rect.bottom + gap,
        bottom: openUp ? window.innerHeight - rect.top + gap : undefined,
        left: rect.left,
        width: rect.width,
        maxHeight,
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    // Capture scroll from nested overflow containers too.
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const menu =
    open && menuBox
      ? createPortal(
          <ul
            ref={menuRef}
            role="listbox"
            aria-labelledby={id}
            className="fixed z-50 overflow-auto rounded-lg border bg-background p-1 shadow-md"
            style={{
              top: menuBox.top,
              bottom: menuBox.bottom,
              left: menuBox.left,
              width: menuBox.width,
              maxHeight: menuBox.maxHeight,
            }}
          >
            <li>
              <button
                type="button"
                role="option"
                aria-selected={!value}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                <span className="size-9 shrink-0" aria-hidden />
                Select a candidate…
              </button>
            </li>
            {candidates.map((candidate) => {
              const taken =
                usedIds.has(candidate.id) && candidate.id !== value;
              const label = ballotCandidateLabel(candidate, theme);
              return (
                <li key={candidate.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={candidate.id === value}
                    disabled={taken}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                      candidate.id === value && "bg-muted",
                      taken && "cursor-not-allowed opacity-40",
                    )}
                    onClick={() => {
                      if (taken) return;
                      onChange(candidate.id);
                      setOpen(false);
                    }}
                  >
                    <PhotoThumb
                      src={
                        candidateHasImage(theme, candidate.url)
                          ? candidate.url
                          : null
                      }
                      alt=""
                    />
                    <span className="min-w-0 truncate">{label}</span>
                    {taken ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        used
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>,
          document.body,
        )
      : null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="border-input bg-background flex h-10 w-full items-center gap-2 rounded-lg border px-2 text-sm"
        onClick={() => setOpen((prev) => !prev)}
      >
        <PhotoThumb
          src={
            candidateHasImage(theme, selected?.url) ? selected?.url : null
          }
          alt=""
          size="sm"
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-left",
            !selected && "text-muted-foreground",
          )}
        >
          {selected
            ? ballotCandidateLabel(selected, theme)
            : "Select a candidate…"}
        </span>
        <CaretDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {menu}
    </div>
  );
}

function BallotRankingList({
  rankings,
  candidates,
  scoringModel,
  theme,
}: {
  rankings: string[];
  candidates: BallotCandidate[];
  scoringModel: ScoringModelId;
  theme?: ContestTheme;
}) {
  const poolSize = candidates.length;
  return (
    <ol className="space-y-2 text-sm">
      {rankings.filter(Boolean).map((id, index) => {
        const candidate = candidates.find((item) => item.id === id);
        const label = ballotCandidateLabel(candidate, theme);
        const scorePool =
          scoringModel === "linear_x" ? rankings.filter(Boolean).length : poolSize;
        return (
          <li key={`${id}-${index}`} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">
              {index + 1}.
            </span>
            {candidateHasImage(theme, candidate?.url) ? (
              <PhotoThumb
                src={candidate?.url}
                alt={label}
                size="sm"
                expandable
              />
            ) : null}
            <p className="min-w-0 leading-none">
              {label}
              <span className="text-muted-foreground">
                {" "}
                ({pointsForRank(scoringModel, index + 1, scorePool)} pts)
              </span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}

export function VotingBallot({
  contestId,
  joinCode,
  scoringModel,
  theme = "generic",
  candidates,
  excludedCandidateIds = [],
  existingRankings,
  locked,
  voteMutability,
  allowEdit = true,
  votingClosesAt = null,
  missedDeadline = false,
  questionId = null,
  questionTitle = null,
  hideQuestionTitle = false,
  hideIntro = false,
}: VotingBallotProps) {
  const router = useRouter();
  const excluded = useMemo(
    () => new Set(excludedCandidateIds),
    [excludedCandidateIds],
  );
  const selectableCandidates = useMemo(
    () => candidates.filter((candidate) => !excluded.has(candidate.id)),
    [candidates, excluded],
  );
  const slotCount = getBallotSlotCount(scoringModel, selectableCandidates.length);
  const [ranks, setRanks] = useState<string[]>(() => {
    if (existingRankings?.length) {
      return Array.from(
        { length: Math.max(existingRankings.length, slotCount) },
        (_, index) => existingRankings[index] ?? "",
      );
    }
    return Array.from({ length: slotCount }, () => "");
  });
  const [editing, setEditing] = useState(!existingRankings?.length);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(castBallotAction, initialState);

  useEffect(() => {
    if (!state?.success) return;
    void broadcastContestResync(contestId);
    router.refresh();
    setEditing(false);
    setConfirmOpen(false);
  }, [state?.success, contestId, router]);

  // When voting opens live, candidates/slots often arrive after the form mounts.
  useEffect(() => {
    setRanks((prev) => {
      if (existingRankings?.length === slotCount && slotCount > 0) {
        const same =
          prev.length === existingRankings.length &&
          prev.every((value, index) => value === existingRankings[index]);
        if (same) return prev;
        return existingRankings;
      }
      if (prev.length === slotCount) return prev;
      return Array.from({ length: slotCount }, (_, index) => prev[index] ?? "");
    });
  }, [slotCount, existingRankings]);

  const usedIds = useMemo(() => new Set(ranks.filter(Boolean)), [ranks]);
  const complete =
    ranks.every(Boolean) && ranks.length === slotCount && slotCount > 0;
  const submitted = Boolean(existingRankings?.length);
  const needsLockConfirm =
    voteMutability === "locked_on_submit" && !submitted;

  if (missedDeadline && !submitted) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">No ballot submitted</p>
        <p className="text-sm text-muted-foreground">
          You did not submit a ballot in time for this contest.
        </p>
      </div>
    );
  }

  if (selectableCandidates.length < 1 && !submitted) {
    return (
      <p className="text-sm text-muted-foreground">
        No candidates available to vote on.
      </p>
    );
  }

  const rankingSource = existingRankings?.length
    ? existingRankings
    : ranks.filter(Boolean);

  if (submitted && (!allowEdit || locked || !editing)) {
    return (
      <div className="space-y-3">
        {questionTitle && !hideQuestionTitle ? (
          <p className="text-sm font-medium">{questionTitle}</p>
        ) : null}
        <div className="space-y-2">
          <p className="text-sm font-medium">Your submitted ranking</p>
          <BallotRankingList
            rankings={rankingSource}
            candidates={candidates}
            scoringModel={scoringModel}
            theme={theme}
          />
        </div>
        {allowEdit && !locked ? (
          <Button type="button" variant="outline" onClick={() => setEditing(true)}>
            Change ballot
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <form ref={formRef} action={formAction} className="space-y-4">
        <input type="hidden" name="contestId" value={contestId} />
        <input type="hidden" name="joinCode" value={joinCode} />
        {questionId ? (
          <input type="hidden" name="questionId" value={questionId} />
        ) : null}
        <input type="hidden" name="rankings" value={JSON.stringify(ranks)} />

        {questionTitle && !hideQuestionTitle ? (
          <p className="text-sm font-medium">{questionTitle}</p>
        ) : null}
        {submitted ? (
          <div className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2">
            <p className="text-sm font-medium">Currently submitted</p>
            <BallotRankingList
              rankings={existingRankings ?? []}
              candidates={candidates}
              scoringModel={scoringModel}
              theme={theme}
            />
          </div>
        ) : null}

        {!hideIntro ? (
          <p className="text-sm text-muted-foreground">
            Rank your top {slotCount}. Higher places earn more points.
          </p>
        ) : null}

        <div className="space-y-3">
          {ranks.map((value, index) => (
            <div key={index} className="space-y-1.5">
              <Label htmlFor={`rank-${index}`}>
                {index + 1}
                {index === 0
                  ? "st"
                  : index === 1
                    ? "nd"
                    : index === 2
                      ? "rd"
                      : "th"}{" "}
                place
                <span className="text-muted-foreground">
                  {" "}
                  · {pointsForRank(scoringModel, index + 1, selectableCandidates.length)}{" "}
                  pts
                </span>
              </Label>
              {theme === "photo" ||
              (theme === "generic" &&
                selectableCandidates.some((candidate) =>
                  candidateHasImage(theme, candidate.url),
                )) ? (
                <PhotoBallotSelect
                  id={`rank-${index}`}
                  value={value}
                  candidates={selectableCandidates}
                  usedIds={usedIds}
                  theme={theme}
                  onChange={(next) => {
                    const ranksNext = [...ranks];
                    ranksNext[index] = next;
                    setRanks(ranksNext);
                  }}
                />
              ) : (
                <select
                  id={`rank-${index}`}
                  className="border-input bg-background h-8 w-full rounded-lg border px-2.5 text-sm"
                  value={value}
                  onChange={(event) => {
                    const next = [...ranks];
                    next[index] = event.target.value;
                    setRanks(next);
                  }}
                  required
                >
                  <option value="">Select a candidate…</option>
                  {selectableCandidates.map((candidate) => {
                    const taken =
                      usedIds.has(candidate.id) && candidate.id !== value;
                    return (
                      <option
                        key={candidate.id}
                        value={candidate.id}
                        disabled={taken}
                      >
                        {ballotCandidateLabel(candidate, theme)}
                      </option>
                    );
                  })}
                  {excluded.size > 0 ? (
                    <option value="" disabled>
                      — own nominations excluded —
                    </option>
                  ) : null}
                </select>
              )}
              {value
                ? (() => {
                    const selected = selectableCandidates.find(
                      (candidate) => candidate.id === value,
                    );
                    return candidateHasImage(theme, selected?.url) ? (
                      <PhotoCandidateImage
                        src={selected!.url!}
                        alt={ballotCandidateLabel(selected, theme)}
                        className="max-h-36 w-full rounded-md border object-contain bg-muted/30"
                      />
                    ) : null;
                  })()
                : null}
            </div>
          ))}
        </div>

        {state?.error ? (
          <p className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {needsLockConfirm ? (
            <Button
              type="button"
              disabled={pending || !complete}
              onClick={() => setConfirmOpen(true)}
            >
              {pending ? "Saving…" : "Submit ballot"}
            </Button>
          ) : (
            <Button type="submit" disabled={pending || !complete}>
              {pending
                ? "Saving…"
                : existingRankings?.length
                  ? "Update ballot"
                  : "Submit ballot"}
            </Button>
          )}
          {submitted && allowEdit && !locked ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setRanks(
                  existingRankings?.length === slotCount
                    ? existingRankings
                    : Array.from({ length: slotCount }, () => ""),
                );
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </form>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Submit ballot permanently?</DialogTitle>
            <DialogDescription>
              Vote changes are locked on submit for this contest. Once you
              confirm, you cannot change your ranking.
            </DialogDescription>
          </DialogHeader>
          {votingClosesAt ? (
            <VotingCountdown
              closesAt={votingClosesAt}
              prefix="Time left to submit:"
              expiredLabel="The voting deadline has already passed."
            />
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending || !complete}
              onClick={() => {
                setConfirmOpen(false);
                formRef.current?.requestSubmit();
              }}
            >
              {pending ? "Saving…" : "Confirm & submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
