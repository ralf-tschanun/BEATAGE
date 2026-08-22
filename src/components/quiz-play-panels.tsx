"use client";

import { useActionState } from "react";
import {
  addCuratedTrackAction,
  closeRoundAction,
  startRoundAction,
  submitGuessAction,
  type QuizRoundActionState,
} from "@/app/actions/quiz-round";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  tracks: CuratedTrackRow[];
  activeRound: RoundRow | null;
  resultRound: RoundRow | null;
  roundGuesses: GuessRow[];
  myGuessYear: number | null;
  leaderboard: LeaderboardRow[];
};

export function QuizPlayPanels({
  quizId,
  joinCode,
  isHost,
  tracks,
  activeRound,
  resultRound,
  roundGuesses,
  myGuessYear,
  leaderboard,
}: QuizPlayPanelsProps) {
  const [addState, addAction, addPending] = useActionState(addCuratedTrackAction, initial);
  const [startState, startAction, startPending] = useActionState(startRoundAction, initial);
  const [guessState, guessAction, guessPending] = useActionState(submitGuessAction, initial);
  const [closeState, closeAction, closePending] = useActionState(closeRoundAction, initial);

  return (
    <div className="space-y-8">
      {isHost ? (
        <section className="rounded-2xl border border-border/60 bg-card/40 p-6 space-y-4">
          <h2 className="text-lg font-semibold">Curated tracks</h2>
          <p className="text-sm text-muted-foreground">
            Add songs in play order. Release years are fetched from Spotify when possible.
          </p>

          <form action={addAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="quizId" value={quizId} />
            <input type="hidden" name="joinCode" value={joinCode} />
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="trackName">Track title</Label>
              <Input id="trackName" name="trackName" required placeholder="Billie Jean" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="artistName">Artist</Label>
              <Input id="artistName" name="artistName" placeholder="Michael Jackson" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spotifyTrackId">Spotify track ID (optional)</Label>
              <Input id="spotifyTrackId" name="spotifyTrackId" placeholder="5ChkMS8X1F5XzEQpq64LdB" />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={addPending}>
                {addPending ? "Adding…" : "Add track"}
              </Button>
            </div>
            {addState?.error ? (
              <p className="text-sm text-destructive sm:col-span-2">{addState.error}</p>
            ) : null}
          </form>

          {tracks.length > 0 ? (
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              {tracks.map((track) => (
                <li key={track.id}>
                  <span className="font-medium">{track.track_name}</span>
                  {track.artist_name ? ` — ${track.artist_name}` : ""}
                  {track.release_year ? (
                    <span className="text-muted-foreground"> · {track.release_year}</span>
                  ) : (
                    <span className="text-muted-foreground"> · year unknown</span>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">No tracks yet.</p>
          )}

          <form action={startAction}>
            <input type="hidden" name="quizId" value={quizId} />
            <input type="hidden" name="joinCode" value={joinCode} />
            <Button type="submit" disabled={startPending || Boolean(activeRound) || tracks.length === 0}>
              {startPending ? "Starting…" : "Start next round"}
            </Button>
            {startState?.error ? (
              <p className="mt-2 text-sm text-destructive">{startState.error}</p>
            ) : null}
          </form>
        </section>
      ) : null}

      {activeRound ? (
        <section className="rounded-2xl border border-primary/30 bg-primary/5 p-6 space-y-4">
          <h2 className="text-lg font-semibold">
            Round {activeRound.round_number} — guess the release year
          </h2>
          <p className="text-sm text-muted-foreground">
            {isHost ? (
              <>
                <span className="font-medium text-foreground">{activeRound.track_name}</span>
                {activeRound.artist_name ? ` — ${activeRound.artist_name}` : ""}
                {isHost && activeRound.correct_release_year ? (
                  <span className="block mt-1 text-primary">
                    Host only: {activeRound.correct_release_year}
                    {activeRound.original_release_year &&
                    activeRound.original_release_year !== activeRound.correct_release_year
                      ? ` (original ${activeRound.original_release_year})`
                      : null}
                  </span>
                ) : null}
              </>
            ) : (
              "A track is playing — enter the release year you think is correct."
            )}
          </p>

          {!isHost ? (
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
                  max={2100}
                  required
                  defaultValue={myGuessYear ?? undefined}
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
          ) : (
            <form action={closeAction}>
              <input type="hidden" name="roundId" value={activeRound.id} />
              <input type="hidden" name="joinCode" value={joinCode} />
              <Button type="submit" variant="secondary" disabled={closePending}>
                {closePending ? "Closing…" : "Close round & score"}
              </Button>
              {closeState?.error ? (
                <p className="mt-2 text-sm text-destructive">{closeState.error}</p>
              ) : null}
            </form>
          )}
        </section>
      ) : null}

      {resultRound && !activeRound ? (
        <section className="rounded-2xl border border-border/60 bg-card/40 p-6 space-y-4">
          <h2 className="text-lg font-semibold">
            Round {resultRound.round_number} results
          </h2>
          <p className="text-sm">
            <span className="font-medium">{resultRound.track_name}</span>
            {resultRound.artist_name ? ` — ${resultRound.artist_name}` : ""}
          </p>
          <p className="text-sm text-primary font-medium">
            Correct release year: {resultRound.correct_release_year ?? "—"}
            {resultRound.original_release_year &&
            resultRound.original_release_year !== resultRound.correct_release_year
              ? ` (original ${resultRound.original_release_year})`
              : null}
          </p>
          <ul className="divide-y divide-border/60 rounded-xl border border-border/60 text-sm">
            {roundGuesses.map((g) => (
              <li key={g.user_id} className="flex justify-between px-4 py-2">
                <span>{g.display_name}</span>
                <span className="text-muted-foreground">
                  {g.guessed_year ?? "—"} · {g.points_total} pt
                </span>
              </li>
            ))}
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
