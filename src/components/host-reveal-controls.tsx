"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  revealAllCandidatesAction,
  revealCandidateAction,
  revealNextCandidateAction,
  type ContestActionState,
} from "@/app/actions/contest";
import {
  applyCandidateLivePatch,
  broadcastContestResync,
  subscribeContestCandidates,
} from "@/components/contest-live-refresh";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CANDIDATE_SORT_OPTIONS,
  sortCandidates,
  type CandidateReveal,
  type CandidateSort,
} from "@/lib/plans";

const initialState: ContestActionState = null;

export type RevealCandidateItem = {
  id: string;
  title: string;
  artist: string | null;
  status: string;
  created_at?: string | null;
  display_order?: number | null;
};

export type RevealCuratedEntryItem = {
  id: string;
  displayName: string;
  birthday: string;
  candidateId: string | null;
};

type HostRevealControlsProps = {
  contestId: string;
  joinCode: string;
  revealMode: CandidateReveal;
  candidateSort: CandidateSort;
  candidates: RevealCandidateItem[];
  nominationsOpen: boolean;
  /** Curated birthday: pending people (songs resolved on release). */
  curatedEntries?: RevealCuratedEntryItem[];
  isCuratedBirthday?: boolean;
  /** When true, the primary reveal action uses the default (focused) button. */
  emphasized?: boolean;
};

export function HostRevealControls({
  contestId,
  joinCode,
  revealMode,
  candidateSort,
  candidates: initialCandidates,
  nominationsOpen,
  curatedEntries = [],
  isCuratedBirthday = false,
  emphasized = false,
}: HostRevealControlsProps) {
  const router = useRouter();
  const [candidates, setCandidates] = useState(initialCandidates);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmKind, setConfirmKind] = useState<
    "all" | "next" | "one" | null
  >(null);
  const [pendingCandidateId, setPendingCandidateId] = useState<string | null>(
    null,
  );
  const allFormRef = useRef<HTMLFormElement>(null);
  const nextFormRef = useRef<HTMLFormElement>(null);
  const oneFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setCandidates(initialCandidates);
  }, [initialCandidates]);

  useEffect(() => {
    return subscribeContestCandidates(contestId, (patch) => {
      setCandidates((prev) => {
        const next = applyCandidateLivePatch(prev, patch, (row) => ({
          id: row.id,
          title: row.title,
          artist: row.artist,
          status: row.status,
          created_at: row.created_at ?? null,
          display_order: row.display_order ?? null,
        }));
        return next ?? prev;
      });
    });
  }, [contestId]);

  const pending = useMemo(
    () =>
      sortCandidates(
        candidates.filter((candidate) => candidate.status === "pending"),
        candidateSort,
      ),
    [candidates, candidateSort],
  );
  const visible = useMemo(
    () => candidates.filter((candidate) => candidate.status === "visible"),
    [candidates],
  );

  const [allState, allAction, allPending] = useActionState(
    revealAllCandidatesAction,
    initialState,
  );
  const [nextState, nextAction, nextPending] = useActionState(
    revealNextCandidateAction,
    initialState,
  );
  const [oneState, oneAction, onePending] = useActionState(
    revealCandidateAction,
    initialState,
  );

  useEffect(() => {
    if (!allState?.success && !nextState?.success && !oneState?.success) {
      return;
    }
    void broadcastContestResync(contestId);
    router.refresh();
  }, [allState, nextState, oneState, contestId, router]);

  const pendingEntries = useMemo(
    () => curatedEntries.filter((entry) => !entry.candidateId),
    [curatedEntries],
  );

  const canRelease = isCuratedBirthday
    ? pendingEntries.length > 0 || pending.length > 0
    : pending.length > 0;

  const sequential = revealMode === "admin_sequential";
  const batch = revealMode === "admin_batch";
  const busy = allPending || nextPending || onePending;
  const actionError =
    allState?.error || nextState?.error || oneState?.error || null;
  const candidateOrderLabel =
    CANDIDATE_SORT_OPTIONS[
      candidateSort as keyof typeof CANDIDATE_SORT_OPTIONS
    ]?.label ?? candidateSort;

  if (!batch && !sequential) return null;

  function requestReveal(kind: "all" | "next" | "one", candidateId?: string) {
    if (kind === "one" && candidateId) {
      setPendingCandidateId(candidateId);
      const input = oneFormRef.current?.elements.namedItem(
        "candidateId",
      ) as HTMLInputElement | null;
      if (input) input.value = candidateId;
    }

    if (nominationsOpen) {
      setConfirmKind(kind);
      setConfirmOpen(true);
      return;
    }

    if (kind === "all") allFormRef.current?.requestSubmit();
    else if (kind === "next") nextFormRef.current?.requestSubmit();
    else if (kind === "one") oneFormRef.current?.requestSubmit();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {isCuratedBirthday
          ? "People stay anonymous until you release. Chart #1 hits are looked up on release, then shown to participants for voting."
          : sequential
            ? "Candidates stay hidden until you reveal them one by one. The first reveal closes nominations."
            : "Candidates stay hidden until you release them. Releasing closes nominations — no further edits or new nominations."}
      </p>

      {nominationsOpen && canRelease ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          Nominations are still open. Releasing candidates will end the
          nomination period immediately.
        </p>
      ) : null}

      <p className="text-sm">
        <span className="text-muted-foreground">Candidate order:</span>{" "}
        {candidateOrderLabel}
        {" · "}
        <span className="text-muted-foreground">Visible:</span> {visible.length}
        {" · "}
        <span className="text-muted-foreground">Pending:</span> {pending.length}
        {isCuratedBirthday ? (
          <>
            {" · "}
            <span className="text-muted-foreground">People pending:</span>{" "}
            {pendingEntries.length}
          </>
        ) : null}
      </p>

      {/* Hidden forms for sequential / single reveal */}
      <form ref={nextFormRef} action={nextAction} className="hidden">
        <input type="hidden" name="contestId" value={contestId} />
        <input type="hidden" name="joinCode" value={joinCode} />
      </form>
      <form ref={oneFormRef} action={oneAction} className="hidden">
        <input type="hidden" name="contestId" value={contestId} />
        <input type="hidden" name="joinCode" value={joinCode} />
        <input
          type="hidden"
          name="candidateId"
          value={pendingCandidateId ?? ""}
        />
      </form>

      {!canRelease ? (
        <p className="text-sm text-foreground">
          {isCuratedBirthday && curatedEntries.length === 0
            ? "Add people with birth dates first, then release to look up chart hits."
            : pending.length === 0 && visible.length === 0
              ? "No candidates yet."
              : "All candidates are revealed."}
        </p>
      ) : sequential && !isCuratedBirthday ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={emphasized ? "default" : "outline"}
            disabled={busy || pending.length === 0}
            onClick={() => requestReveal("next")}
          >
            {nextPending ? "Revealing…" : "Reveal next"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || pending.length === 0}
            onClick={() => requestReveal("all")}
          >
            {allPending ? "Releasing…" : "Reveal all remaining"}
          </Button>
        </div>
      ) : (
        <form ref={allFormRef} action={allAction}>
          <input type="hidden" name="contestId" value={contestId} />
          <input type="hidden" name="joinCode" value={joinCode} />
          <Button
            type={nominationsOpen ? "button" : "submit"}
            variant={emphasized ? "default" : "outline"}
            disabled={busy}
            onClick={
              nominationsOpen ? () => requestReveal("all") : undefined
            }
          >
            {allPending
              ? "Releasing…"
              : isCuratedBirthday
                ? "Look up charts & release all"
                : "Release all candidates"}
          </Button>
        </form>
      )}

      {/* Batch form always available for sequential "reveal all" */}
      {sequential && !isCuratedBirthday ? (
        <form ref={allFormRef} action={allAction} className="hidden">
          <input type="hidden" name="contestId" value={contestId} />
          <input type="hidden" name="joinCode" value={joinCode} />
        </form>
      ) : null}

      {actionError ? (
        <p className="text-sm text-destructive" role="alert">
          {actionError}
        </p>
      ) : null}

      {isCuratedBirthday && pendingEntries.length > 0 ? (
        <ul className="space-y-2">
          {pendingEntries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{entry.displayName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {entry.birthday}
                </p>
              </div>
              <Badge variant="outline">awaiting lookup</Badge>
            </li>
          ))}
        </ul>
      ) : null}

      {!isCuratedBirthday && pending.length > 0 ? (
        <ul className="space-y-2">
          {pending.map((candidate, index) => (
            <li
              key={candidate.id}
              className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {sequential ? (
                    <span className="mr-1.5 text-muted-foreground">
                      #{index + 1}
                    </span>
                  ) : null}
                  {candidate.title}
                </p>
                {candidate.artist ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {candidate.artist}
                  </p>
                ) : null}
              </div>
              {sequential ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => requestReveal("one", candidate.id)}
                >
                  Reveal
                </Button>
              ) : (
                <Badge variant="outline">pending</Badge>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>End nominations and reveal?</DialogTitle>
            <DialogDescription>
              Nominations are still open. Revealing candidates will close the
              nomination period permanently — participants cannot add or edit
              nominations afterward. Continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirmOpen(false);
                if (confirmKind === "all") allFormRef.current?.requestSubmit();
                else if (confirmKind === "next") {
                  nextFormRef.current?.requestSubmit();
                } else if (confirmKind === "one") {
                  oneFormRef.current?.requestSubmit();
                }
              }}
            >
              {busy ? "Revealing…" : "Reveal & close nominations"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
