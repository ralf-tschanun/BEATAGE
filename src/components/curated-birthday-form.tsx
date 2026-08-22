"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addCuratedBirthdayEntryAction,
  deleteCuratedBirthdayEntryAction,
  type ContestActionState,
} from "@/app/actions/contest";
import { broadcastContestResync } from "@/components/contest-live-refresh";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CHART_COUNTRY_OPTIONS, type ChartCountry } from "@/lib/charts";

const initialState: ContestActionState = null;

export type CuratedBirthdayEntryRow = {
  id: string;
  displayName: string;
  birthday: string;
  candidateId: string | null;
  sortOrder: number;
};

type CuratedBirthdayFormProps = {
  contestId: string;
  joinCode: string;
  chartCountry: ChartCountry;
  nominationsOpen: boolean;
  remainingEntries: number | null;
  initialEntries: CuratedBirthdayEntryRow[];
  dateOffsetLabel?: string;
};

export function CuratedBirthdayForm({
  contestId,
  joinCode,
  chartCountry,
  nominationsOpen,
  remainingEntries,
  initialEntries,
  dateOffsetLabel,
}: CuratedBirthdayFormProps) {
  const router = useRouter();
  const [entries, setEntries] = useState(initialEntries);
  const [displayName, setDisplayName] = useState("");
  const [birthday, setBirthday] = useState("");

  const [addState, addAction, addPending] = useActionState(
    addCuratedBirthdayEntryAction,
    initialState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteCuratedBirthdayEntryAction,
    initialState,
  );

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  useEffect(() => {
    if (addState?.success || deleteState?.success) {
      void broadcastContestResync(contestId);
      router.refresh();
    }
  }, [addState, deleteState, router, contestId]);

  const canAdd =
    nominationsOpen &&
    (remainingEntries === null || remainingEntries > 0) &&
    displayName.trim().length > 0 &&
    birthday.length > 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Add people by name and birth date. Songs are looked up from{" "}
        {CHART_COUNTRY_OPTIONS[chartCountry].label} for{" "}
        {dateOffsetLabel ?? "the birthday itself"} when you release candidates —
        participants only see anonymous songs until then.
      </p>

      {nominationsOpen ? (
        <form action={addAction} className="space-y-3 rounded-lg border p-3">
          <input type="hidden" name="contestId" value={contestId} />
          <input type="hidden" name="joinCode" value={joinCode} />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="curatedName">Name</Label>
              <Input
                id="curatedName"
                name="displayName"
                required
                maxLength={80}
                placeholder="Anna"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="curatedBirthday">Birth date</Label>
              <Input
                id="curatedBirthday"
                name="birthday"
                type="date"
                required
                min={CHART_COUNTRY_OPTIONS[chartCountry].availableFrom}
                max={new Date().toISOString().slice(0, 10)}
                value={birthday}
                onChange={(event) => setBirthday(event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={addPending || !canAdd}>
              {addPending ? "Adding…" : "Add person"}
            </Button>
            {remainingEntries !== null ? (
              <span className="text-xs text-muted-foreground">
                {remainingEntries} slot{remainingEntries === 1 ? "" : "s"} left
              </span>
            ) : null}
          </div>

          {addState?.error ? (
            <p className="text-sm text-destructive" role="alert">
              {addState.error}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">Nominations are closed.</p>
      )}

      {entries.length > 0 ? (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="font-medium truncate">{entry.displayName}</p>
                <p className="text-sm text-muted-foreground">{entry.birthday}</p>
              </div>
              {entry.candidateId ? (
                <span className="text-xs text-muted-foreground">Chart linked</span>
              ) : nominationsOpen ? (
                <form action={deleteAction}>
                  <input type="hidden" name="contestId" value={contestId} />
                  <input type="hidden" name="joinCode" value={joinCode} />
                  <input type="hidden" name="entryId" value={entry.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={deletePending}
                  >
                    Remove
                  </Button>
                </form>
              ) : (
                <span className="text-xs text-muted-foreground">Pending reveal</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No entries yet.</p>
      )}

      {deleteState?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {deleteState.error}
        </p>
      ) : null}
    </div>
  );
}
