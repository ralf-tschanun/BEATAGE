"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  nominateBirthdayAction,
  type ContestActionState,
} from "@/app/actions/contest";
import { broadcastContestResync } from "@/components/contest-live-refresh";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { scrollToSection } from "@/lib/scroll";
import type { ChartCountry } from "@/lib/charts";
import { CHART_COUNTRY_OPTIONS } from "@/lib/charts";
import {
  applyBirthdayOffset,
  formatBirthdayOffsetLabel,
  type BirthdayDateOffset,
} from "@/lib/birthday-offset";

const initialState: ContestActionState = null;

type BirthdayNominateFormProps = {
  contestId: string;
  joinCode: string;
  chartCountry: ChartCountry;
  nominationsOpen: boolean;
  alreadySubmitted?: boolean;
  /** False when birthday was saved but no chart #1 matched. */
  hadChartMatch?: boolean | null;
  initialBirthday?: string | null;
  initialShowBirthday?: boolean;
  dateOffset?: BirthdayDateOffset;
};

export function BirthdayNominateForm({
  contestId,
  joinCode,
  chartCountry,
  nominationsOpen,
  alreadySubmitted = false,
  hadChartMatch = null,
  initialBirthday = null,
  initialShowBirthday = false,
  dateOffset = { amount: 0, unit: "years" },
}: BirthdayNominateFormProps) {
  const router = useRouter();
  const [birthday, setBirthday] = useState(initialBirthday ?? "");
  const [showBirthday, setShowBirthday] = useState(initialShowBirthday);
  const [state, formAction, pending] = useActionState(
    nominateBirthdayAction,
    initialState,
  );

  const lookupDate = useMemo(
    () =>
      birthday
        ? applyBirthdayOffset(birthday, dateOffset.amount, dateOffset.unit)
        : null,
    [birthday, dateOffset.amount, dateOffset.unit],
  );

  useEffect(() => {
    setBirthday(initialBirthday ?? "");
    setShowBirthday(initialShowBirthday);
  }, [initialBirthday, initialShowBirthday]);

  useEffect(() => {
    if (!state?.success) return;
    void broadcastContestResync(contestId);
    router.refresh();
    scrollToSection("contest-candidates");
  }, [state, router, contestId]);

  const offsetLabel = formatBirthdayOffsetLabel(dateOffset);

  if (!nominationsOpen) {
    if (!alreadySubmitted) {
      return (
        <p className="text-sm text-muted-foreground">
          Nominations are closed. You did not submit a birthday.
        </p>
      );
    }
    return (
      <div className="space-y-2 rounded-lg border px-3 py-3">
        <p className="text-sm font-medium">Your birthday</p>
        <p className="text-sm text-muted-foreground">{initialBirthday}</p>
        {dateOffset.amount !== 0 ? (
          <p className="text-xs text-muted-foreground">
            Chart date: {offsetLabel}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {hadChartMatch === false
            ? "No Billboard #1 matched this date — you were not nominated."
            : "Your chart hit stays private until the host reveals candidates."}
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="contestId" value={contestId} />
      <input type="hidden" name="joinCode" value={joinCode} />
      <input type="hidden" name="chartCountry" value={chartCountry} />
      <input type="hidden" name="showBirthday" value={showBirthday ? "true" : "false"} />

      <p className="text-sm text-muted-foreground">
        Enter your birthday. We&apos;ll look up the{" "}
        {CHART_COUNTRY_OPTIONS[chartCountry].label} #1 for{" "}
        <span className="font-medium text-foreground">{offsetLabel}</span> and
        nominate it privately — you won&apos;t see the song until the host reveals
        candidates. If that chart date is not available yet (for example you are
        younger than a +25 years offset), we use the latest available #1 instead.
        You can change your birthday until nominations close.
      </p>

      <div className="space-y-2">
        <Label htmlFor="birthday">Birthday</Label>
        <Input
          id="birthday"
          name="birthday"
          type="date"
          required
          min="1900-01-01"
          max={new Date().toISOString().slice(0, 10)}
          value={birthday}
          onChange={(event) => setBirthday(event.target.value)}
        />
        {lookupDate && dateOffset.amount !== 0 ? (
          <p className="text-xs text-muted-foreground">
            Chart lookup date: <span className="font-medium">{lookupDate}</span>
            {lookupDate > new Date().toISOString().slice(0, 10)
              ? " — not available yet; latest chart #1 will be used."
              : null}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Chart coverage from {CHART_COUNTRY_OPTIONS[chartCountry].availableFrom}
          {chartCountry === "AT"
            ? " (Austrian charts from 1989; earlier dates use German charts)."
            : "."}
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={showBirthday}
          onChange={(event) => setShowBirthday(event.target.checked)}
        />
        <span>
          I agree that my birthday may be shown in the results. If anyone in this
          contest declines, birthdays stay hidden for everyone (including the
          host).
        </span>
      </label>

      {alreadySubmitted && hadChartMatch === false ? (
        <p className="text-sm text-muted-foreground">
          Currently saved with no chart match. Change the date to try again, or
          keep it — you stay without a nomination.
        </p>
      ) : null}

      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      {state?.success ? (
        <p className="text-sm text-foreground" role="status">
          {state.message ?? "Birthday saved."}
        </p>
      ) : null}

      <Button type="submit" disabled={pending || !birthday}>
        {pending
          ? "Looking up chart…"
          : alreadySubmitted
            ? "Update birthday"
            : "Submit birthday"}
      </Button>
    </form>
  );
}
