"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addCuratedTrackAction,
  closeRoundAction,
  finishQuizAction,
  startRoundAction,
  submitGuessAction,
  type QuizRoundActionState,
} from "@/app/actions/quiz-round";
import {
  broadcastQuizResync,
  subscribeQuizGuesses,
  subscribeQuizPlay,
  type QuizGuessLivePatch,
  type QuizPlaySnapshot,
} from "@/components/quiz-live-refresh";
import { SongPickFields } from "@/components/song-pick-fields";
import { SongPreviewPlayer } from "@/components/song-preview-player";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BILLING_SKU_LABELS } from "@/lib/billing-copy";
import type {
  CuratedTrackRow,
  GuessRow,
  LeaderboardRow,
  RoundRow,
} from "@/lib/quizzes/play-state";

const initial: QuizRoundActionState = null;

type QuizPlayPanelsProps = {
  quizId: string;
  joinCode: string;
  isHost: boolean;
  memberCount: number;
  tracks: CuratedTrackRow[];
  currentRoundNumber: number;
  activeRound: RoundRow | null;
  resultRound: RoundRow | null;
  roundGuesses: GuessRow[];
  myGuessYear: number | null;
  leaderboard: LeaderboardRow[];
  quizStatus: string;
  maxCuratedTracks: number | null;
  /** Guest sessions need an email account before Polar unlock checkout. */
  isAnonymous?: boolean;
};

export function QuizPlayPanels({
  quizId,
  joinCode,
  isHost,
  memberCount: memberCountProp,
  tracks: tracksProp,
  currentRoundNumber: currentRoundNumberProp,
  activeRound: activeRoundProp,
  resultRound: resultRoundProp,
  roundGuesses: roundGuessesProp,
  myGuessYear: myGuessYearProp,
  leaderboard: leaderboardProp,
  quizStatus: quizStatusProp,
  maxCuratedTracks: maxCuratedTracksProp,
  isAnonymous = false,
}: QuizPlayPanelsProps) {
  const router = useRouter();
  const lastSyncIdRef = useRef<string | null>(null);
  const [addState, addAction, addPending] = useActionState(addCuratedTrackAction, initial);
  const [startState, startAction, startPending] = useActionState(startRoundAction, initial);
  const [guessState, guessAction, guessPending] = useActionState(submitGuessAction, initial);
  const [closeState, closeAction, closePending] = useActionState(closeRoundAction, initial);
  const [finishState, finishAction, finishPending] = useActionState(finishQuizAction, initial);
  const [showAddTrack, setShowAddTrack] = useState(false);
  const [draftTrack, setDraftTrack] = useState({
    title: "",
    artist: "",
    previewUrl: "",
  });

  // Live snapshot (MyContest pattern) — client fetch beats waiting on RSC alone.
  const [live, setLive] = useState<QuizPlaySnapshot>(() => ({
    currentRoundNumber: currentRoundNumberProp,
    tracks: tracksProp,
    activeRound: activeRoundProp,
    resultRound: resultRoundProp,
    roundGuesses: roundGuessesProp,
    myGuessYear: myGuessYearProp,
    leaderboard: leaderboardProp,
    memberCount: memberCountProp,
    quizStatus: quizStatusProp,
    maxCuratedTracks: maxCuratedTracksProp,
  }));

  const tracks = live.tracks;
  const currentRoundNumber = live.currentRoundNumber;
  const activeRound = live.activeRound;
  const resultRound = live.resultRound;
  const roundGuesses = live.roundGuesses;
  const myGuessYear = live.myGuessYear;
  const leaderboard = live.leaderboard;
  const memberCount = live.memberCount;
  const quizStatus = live.quizStatus;
  const isFinished = quizStatus === "finished" || quizStatus === "expired";
  const maxCuratedTracks = live.maxCuratedTracks;
  const atTrackLimit =
    maxCuratedTracks != null && tracks.length >= maxCuratedTracks;
  const addHitTrackLimit = Boolean(
    addState?.error &&
      (addState.error.includes("maximum of") || addState.error.includes("TRACK_LIMIT")),
  );
  const showTrackUnlockCta = isHost && !isFinished && (atTrackLimit || addHitTrackLimit);
  const unlockCheckoutPath = `/api/billing/checkout?sku=quiz_unlock&quizId=${encodeURIComponent(quizId)}`;
  const unlockHref = isAnonymous
    ? `/billing/account?next=${encodeURIComponent(unlockCheckoutPath)}`
    : unlockCheckoutPath;

  const [guessYear, setGuessYear] = useState(
    myGuessYearProp != null ? String(myGuessYearProp) : "",
  );
  // Host list: patch from broadcast/postgres immediately (don't wait on snapshot alone).
  const [liveGuesses, setLiveGuesses] = useState(roundGuessesProp);

  useEffect(() => {
    return subscribeQuizPlay(quizId, (patch) => {
      if (patch.type === "replace") {
        setLive(patch.snapshot);
        return;
      }
      router.refresh();
    });
  }, [quizId, router]);

  useEffect(() => {
    if (!addState?.ok) return;
    setDraftTrack({ title: "", artist: "", previewUrl: "" });
    // Keep typing: focus the cleared search field for the next song.
    window.requestAnimationFrame(() => {
      const input = document.getElementById("host-add-track-search");
      if (input instanceof HTMLElement) {
        input.focus({ preventScroll: true });
        input.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  }, [addState]);

  useEffect(() => {
    setGuessYear(myGuessYear != null ? String(myGuessYear) : "");
  }, [myGuessYear, activeRound?.id]);

  useEffect(() => {
    setLiveGuesses(roundGuesses);
  }, [roundGuesses, activeRound?.id]);

  useEffect(() => {
    return subscribeQuizGuesses(quizId, (patch: QuizGuessLivePatch) => {
      if (!activeRound || patch.roundId !== activeRound.id) return;
      setLiveGuesses((prev) => {
        const index = prev.findIndex((row) => row.user_id === patch.userId);
        if (index === -1) {
          return [
            ...prev,
            {
              user_id: patch.userId,
              display_name: patch.displayName ?? "Player",
              guessed_year: patch.guessedYear,
              points_total: 0,
            },
          ];
        }
        const next = [...prev];
        next[index] = {
          ...next[index],
          guessed_year: patch.guessedYear,
          display_name: patch.displayName ?? next[index].display_name,
        };
        return next;
      });
    });
  }, [quizId, activeRound]);

  // After any successful play action: notify peers + soft refresh (MyContest pattern).
  useEffect(() => {
    const syncId =
      addState?.syncId ??
      startState?.syncId ??
      guessState?.syncId ??
      closeState?.syncId ??
      finishState?.syncId ??
      null;
    if (!syncId || syncId === lastSyncIdRef.current) return;
    lastSyncIdRef.current = syncId;
    void broadcastQuizResync(
      quizId,
      joinCode,
      guessState?.syncId === syncId && guessState.guess
        ? { guess: guessState.guess }
        : undefined,
    );
    router.refresh();
  }, [addState, startState, guessState, closeState, finishState, quizId, joinCode, router]);

  const remainingCount = Math.max(0, tracks.length - currentRoundNumber);
  const allTracksPlayed = tracks.length > 0 && remainingCount === 0 && !activeRound;
  const quizComplete = isFinished || allTracksPlayed;
  const canFinish = isHost && !isFinished && !activeRound;
  const waitingForHost = !isHost && !activeRound && !quizComplete && !isFinished;

  return (
    <div className="space-y-8">
      {isHost ? (
        <section className="space-y-4 rounded-2xl border border-border/60 bg-card/40 p-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Host controls</h2>
            <p className="text-sm text-muted-foreground">
              Playlist from create · {tracks.length}
              {maxCuratedTracks != null ? ` / ${maxCuratedTracks}` : ""} track
              {tracks.length === 1 ? "" : "s"}
              {tracks.length > 0
                ? ` · ${remainingCount} left to play`
                : " — add songs before starting"}
              {memberCount > 0 ? ` · ${memberCount} player${memberCount === 1 ? "" : "s"}` : ""}
            </p>
          </div>

          {tracks.length > 0 ? (
            <ol className="max-h-48 list-decimal space-y-1 overflow-y-auto pl-5 text-sm">
              {tracks.map((track, index) => {
                const played = index < currentRoundNumber;
                const isNext = !activeRound && index === currentRoundNumber;
                return (
                  <li
                    key={track.id}
                    className={
                      played
                        ? "text-muted-foreground line-through"
                        : isNext
                          ? "font-medium text-foreground"
                          : undefined
                    }
                  >
                    <span className="font-medium">{track.track_name}</span>
                    {track.artist_name ? ` — ${track.artist_name}` : ""}
                    {track.release_year ? (
                      <span className="text-muted-foreground"> · {track.release_year}</span>
                    ) : (
                      <span className="text-muted-foreground"> · year unknown</span>
                    )}
                    {isNext ? (
                      <span className="ml-2 text-xs text-primary">next</span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">
              No curated tracks yet. Add at least one song below.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <form action={startAction}>
              <input type="hidden" name="quizId" value={quizId} />
              <input type="hidden" name="joinCode" value={joinCode} />
              <Button
                type="submit"
                disabled={
                  startPending ||
                  isFinished ||
                  Boolean(activeRound) ||
                  tracks.length === 0 ||
                  allTracksPlayed
                }
              >
                {startPending
                  ? "Starting…"
                  : activeRound
                    ? "Round in progress"
                    : remainingCount > 0
                      ? currentRoundNumber === 0
                        ? "Start first round"
                        : "Start next round"
                      : tracks.length === 0
                        ? "Add tracks first"
                        : "All tracks played"}
              </Button>
            </form>
            <Button
              type="button"
              variant="outline"
              disabled={isFinished || (atTrackLimit && !showAddTrack)}
              onClick={() => setShowAddTrack((open) => !open)}
            >
              {showAddTrack
                ? "Hide add track"
                : atTrackLimit
                  ? `Song limit reached (${maxCuratedTracks})`
                  : "Add track"}
            </Button>
            {canFinish ? (
              <form action={finishAction}>
                <input type="hidden" name="quizId" value={quizId} />
                <input type="hidden" name="joinCode" value={joinCode} />
                <Button
                  type="submit"
                  variant={allTracksPlayed ? "default" : "secondary"}
                  disabled={finishPending}
                >
                  {finishPending
                    ? "Finishing…"
                    : allTracksPlayed
                      ? "Finish quiz"
                      : "End quiz early"}
                </Button>
              </form>
            ) : null}
          </div>
          {startState?.error ? (
            <p className="text-sm text-destructive">{startState.error}</p>
          ) : null}
          {finishState?.error ? (
            <p className="text-sm text-destructive">{finishState.error}</p>
          ) : null}
          {canFinish && allTracksPlayed ? (
            <p className="text-sm text-muted-foreground">
              All curated tracks have been played. Finish the quiz to lock the final
              leaderboard — or add another track to keep going.
            </p>
          ) : null}

          {showTrackUnlockCta ? (
            <p className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-foreground">
              {maxCuratedTracks != null
                ? `This quiz is at the ${maxCuratedTracks}-song limit.`
                : "This quiz is at the song limit."}{" "}
              <a
                href={unlockHref}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Unlock this quiz ({BILLING_SKU_LABELS.quiz_unlock})
              </a>{" "}
              for unlimited songs, unlimited participants, and no inactivity expiry.
            </p>
          ) : null}

          {addState?.error && !showAddTrack ? (
            <p className="text-sm text-destructive">{addState.error}</p>
          ) : null}

          {showAddTrack && !isFinished && !atTrackLimit ? (
            <form action={addAction} className="space-y-3 rounded-xl border border-border/60 p-4">
              <input type="hidden" name="quizId" value={quizId} />
              <input type="hidden" name="joinCode" value={joinCode} />
              <input type="hidden" name="trackName" value={draftTrack.title} />
              <input type="hidden" name="artistName" value={draftTrack.artist} />
              <SongPickFields
                compact
                value={draftTrack}
                idPrefix="host-add-track"
                searchLabel="Search song to add"
                onChange={setDraftTrack}
              />
              <Button
                type="submit"
                disabled={addPending || !draftTrack.title.trim() || !draftTrack.artist.trim()}
              >
                {addPending ? "Adding…" : "Add to playlist"}
              </Button>
              {addState?.error ? (
                <p className="text-sm text-destructive" role="alert">
                  {addState.error}
                  {addHitTrackLimit ? (
                    <>
                      {" "}
                      <a
                        href={unlockHref}
                        className="font-medium text-primary underline-offset-4 hover:underline"
                      >
                        Unlock this quiz ({BILLING_SKU_LABELS.quiz_unlock})
                      </a>{" "}
                      for unlimited songs.
                    </>
                  ) : null}
                </p>
              ) : null}
            </form>
          ) : null}
        </section>
      ) : null}

      {waitingForHost ? (
        <section className="space-y-2 rounded-2xl border border-dashed border-border/70 bg-muted/20 p-6">
          <h2 className="text-lg font-semibold">Waiting for the host</h2>
          <p className="text-sm text-muted-foreground">
            {currentRoundNumber > 0
              ? `Round ${currentRoundNumber} is done. Hang tight — the host will start the next round.`
              : "The quiz is live. This page updates automatically when the host starts a round."}
          </p>
        </section>
      ) : null}

      {isFinished ? (
        <section className="space-y-2 rounded-2xl border border-border/60 bg-card/40 p-6">
          <h2 className="text-lg font-semibold">Quiz finished</h2>
          <p className="text-sm text-muted-foreground">
            This quiz is closed. Final standings are on the leaderboard below.
          </p>
        </section>
      ) : allTracksPlayed ? (
        <section className="space-y-2 rounded-2xl border border-border/60 bg-card/40 p-6">
          <h2 className="text-lg font-semibold">All tracks played</h2>
          <p className="text-sm text-muted-foreground">
            {isHost
              ? "Add another song to continue, or finish the quiz to lock results."
              : "Waiting for the host to finish the quiz or start another round."}
          </p>
        </section>
      ) : null}

      {activeRound ? (
        <section className="space-y-4 rounded-2xl border border-primary/30 bg-primary/5 p-6">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">
              Live round
            </p>
            <h2 className="text-lg font-semibold">
              Round {activeRound.round_number} — guess the release year
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {isHost ? (
              <>
                <span className="font-medium text-foreground">{activeRound.track_name}</span>
                {activeRound.artist_name ? ` — ${activeRound.artist_name}` : ""}
                {activeRound.correct_release_year ? (
                  <span className="mt-1 block text-primary">
                    Host only: {activeRound.correct_release_year}
                    {activeRound.original_release_year &&
                    activeRound.original_release_year !== activeRound.correct_release_year
                      ? ` (original ${activeRound.original_release_year})`
                      : null}
                  </span>
                ) : null}
              </>
            ) : (
              "Listen to the track the host is playing, then enter the release year. Updates appear live for everyone."
            )}
          </p>

          {isHost && activeRound.preview_url ? (
            <SongPreviewPlayer
              previewUrl={activeRound.preview_url}
              label={`${activeRound.track_name ?? "Track"} preview`}
            />
          ) : null}

          <form action={guessAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="roundId" value={activeRound.id} />
            <input type="hidden" name="joinCode" value={joinCode} />
            <div className="space-y-2">
              <Label htmlFor="guessedYear">Release year</Label>
              <Input
                id="guessedYear"
                name="guessedYear"
                type="number"
                min={1900}
                max={new Date().getFullYear()}
                required
                value={guessYear}
                onChange={(event) => setGuessYear(event.target.value)}
                className="w-32"
              />
            </div>
            <Button type="submit" disabled={guessPending}>
              {guessPending ? "Saving…" : myGuessYear != null ? "Update guess" : "Submit guess"}
            </Button>
            {guessState?.error ? (
              <p className="w-full text-sm text-destructive">{guessState.error}</p>
            ) : null}
            {myGuessYear != null && !guessState?.error ? (
              <p className="w-full text-sm text-muted-foreground">
                Your current guess: {myGuessYear}
              </p>
            ) : null}
          </form>

          {isHost ? (
            <form action={closeAction}>
              <input type="hidden" name="roundId" value={activeRound.id} />
              <input type="hidden" name="joinCode" value={joinCode} />
              <Button type="submit" variant="secondary" disabled={closePending}>
                {closePending ? "Closing…" : "Close round & reveal"}
              </Button>
              {closeState?.error ? (
                <p className="mt-2 text-sm text-destructive">{closeState.error}</p>
              ) : null}
            </form>
          ) : null}

          {isHost ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Guesses so far ({liveGuesses.length}
                {memberCount > 0 ? ` / ${memberCount}` : ""})
              </p>
              {liveGuesses.length > 0 ? (
                <ul className="divide-y divide-border/60 rounded-xl border border-border/60 text-sm">
                  {liveGuesses.map((g) => (
                    <li key={g.user_id} className="flex justify-between px-4 py-2">
                      <span>{g.display_name}</span>
                      <span className="text-muted-foreground">{g.guessed_year ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Waiting for players to submit — this list updates live.
                </p>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {resultRound && !activeRound ? (
        <section className="space-y-4 rounded-2xl border border-border/60 bg-card/40 p-6">
          <h2 className="text-lg font-semibold">
            Round {resultRound.round_number} results
          </h2>
          <p className="text-sm">
            <span className="font-medium">{resultRound.track_name}</span>
            {resultRound.artist_name ? ` — ${resultRound.artist_name}` : ""}
          </p>
          {resultRound.preview_url ? (
            <SongPreviewPlayer
              previewUrl={resultRound.preview_url}
              label={`${resultRound.track_name ?? "Track"} preview`}
            />
          ) : null}
          <p className="text-sm font-medium text-primary">
            Correct release year: {resultRound.correct_release_year ?? "—"}
            {resultRound.original_release_year &&
            resultRound.original_release_year !== resultRound.correct_release_year
              ? ` (original ${resultRound.original_release_year})`
              : null}
          </p>
          <ul className="divide-y divide-border/60 rounded-xl border border-border/60 text-sm">
            {roundGuesses.length > 0 ? (
              roundGuesses.map((g) => (
                <li key={g.user_id} className="flex justify-between px-4 py-2">
                  <span>{g.display_name}</span>
                  <span className="text-muted-foreground">
                    {g.guessed_year ?? "—"} · {g.points_total} pt
                  </span>
                </li>
              ))
            ) : (
              <li className="px-4 py-3 text-muted-foreground">No guesses this round.</li>
            )}
          </ul>
        </section>
      ) : null}

      {leaderboard.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Leaderboard</h2>
          <ul className="divide-y divide-border/60 rounded-2xl border border-border/60">
            {leaderboard.map((row, index) => (
              <li
                key={row.user_id}
                className="flex items-center justify-between px-4 py-3 text-sm"
              >
                <span>
                  #{index + 1} {row.display_name}
                </span>
                <span className="font-medium">{row.total_points} pt</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
