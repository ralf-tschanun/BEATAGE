"use client";

import { useMemo } from "react";
import { SongPreviewPlayer } from "@/components/song-preview-player";
import { SpotifyTrackLink } from "@/components/spotify-track-link";
import { PhotoCandidateImage, CandidateUrlPreview } from "@/components/photo-candidate-image";
import { StarMeter } from "@/components/star-rating";
import { useFlipList } from "@/components/use-flip-list";
import type { ContestTheme, ResultRow, SongLinksMode } from "@/lib/plans";
import { podiumRankClass, podiumRowClass } from "@/lib/result-podium-styles";
import { formatPhotoLabel } from "@/lib/photo-labels";
import { isContestImageUrl } from "@/lib/contest-photos";
import { cn } from "@/lib/utils";

type SpotifyLinkInfo = {
  url: string;
  uri?: string | null;
};

export type BallotPresenter = {
  userId: string;
  displayName: string;
};

function formatPresenterLabel(
  presenter: BallotPresenter,
  currentUserId?: string | null,
): string {
  const name = presenter.displayName.trim();
  if (currentUserId && presenter.userId === currentUserId) {
    return `${name} (you)`;
  }
  return name;
}

type ContestResultsProps = {
  results: ResultRow[];
  ballotCount: number;
  /** When set, show progress as count/total (ballot-by-ballot reveal). */
  ballotTotal?: number | null;
  theme: ContestTheme;
  scoringLabel: string;
  subtitle?: string | null;
  /**
   * Ballot-by-ballot: voters already presented (order of reveal).
   * The last entry is the ballot just added — shown more prominently.
   */
  resultAfterPresenters?: BallotPresenter[] | null;
  waiting?: boolean;
  /** Ballot-by-ballot: participant whose ballot is revealed next. */
  nextBallotPresenter?: BallotPresenter | null;
  currentUserId?: string | null;
  contestId?: string;
  isHost?: boolean;
  songLinks?: SongLinksMode;
  spotifyByCandidateId?: Record<string, SpotifyLinkInfo>;
  /** candidateId → birthday labels (only when all participants consented). */
  birthdayLabelsByCandidateId?: Record<string, string[]>;
  /** Ballot-by-ballot reveal: points from the most recently added ballot. */
  latestBallotDeltaByCandidateId?: Record<string, number>;
  /** Photo contest: candidateId → display number (Photo N - …). */
  photoNumberByCandidateId?: Record<string, number>;
  /** Star rating: show numeric point totals next to stars. Default off. */
  showStarPoints?: boolean;
};

function ResultAfterLine({
  presenters,
  currentUserId,
}: {
  presenters: BallotPresenter[];
  currentUserId?: string | null;
}) {
  if (presenters.length === 0) return null;
  const earlier = presenters.slice(0, -1);
  const latest = presenters[presenters.length - 1]!;
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">Result after: </span>
      {earlier.length > 0 ? (
        <span className="text-muted-foreground">
          {earlier.map((presenter) => formatPresenterLabel(presenter, currentUserId)).join(", ")}
          {", "}
        </span>
      ) : null}
      <span className="font-semibold text-foreground">
        {formatPresenterLabel(latest, currentUserId)}
      </span>
    </p>
  );
}

function NextBallotLine({
  presenter,
  currentUserId,
}: {
  presenter: BallotPresenter;
  currentUserId?: string | null;
}) {
  return (
    <p className="text-sm text-muted-foreground">
      Next ballot presented: {formatPresenterLabel(presenter, currentUserId)}
    </p>
  );
}

export function ContestResults({
  results,
  ballotCount: _ballotCount,
  ballotTotal: _ballotTotal = null,
  theme,
  scoringLabel: _scoringLabel,
  subtitle = null,
  resultAfterPresenters = null,
  waiting = false,
  nextBallotPresenter = null,
  currentUserId = null,
  contestId,
  isHost = false,
  songLinks = "preview",
  spotifyByCandidateId,
  birthdayLabelsByCandidateId,
  latestBallotDeltaByCandidateId,
  photoNumberByCandidateId,
  showStarPoints = false,
}: ContestResultsProps) {
  const flipOrderKey = useMemo(
    () => results.map((row) => `${row.candidateId}:${row.rank}`).join("|"),
    [results],
  );
  const listRef = useFlipList(flipOrderKey);

  const header = (
    <div className="space-y-1">
      {resultAfterPresenters && resultAfterPresenters.length > 0 ? (
        <ResultAfterLine
          presenters={resultAfterPresenters}
          currentUserId={currentUserId}
        />
      ) : subtitle ? (
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      ) : null}
      {nextBallotPresenter ? (
        <NextBallotLine
          presenter={nextBallotPresenter}
          currentUserId={currentUserId}
        />
      ) : null}
    </div>
  );
  const showHeader =
    Boolean(subtitle) ||
    Boolean(nextBallotPresenter) ||
    Boolean(resultAfterPresenters && resultAfterPresenters.length > 0);

  if (waiting) {
    return (
      <div className="space-y-2">
        {showHeader ? header : null}
        <p className="text-sm text-muted-foreground">
          Waiting for the host to reveal the next results step…
        </p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="space-y-2">
        {showHeader ? header : null}
        <p className="text-sm text-muted-foreground">No results yet.</p>
      </div>
    );
  }

  const showSpotify = theme === "song" && (isHost || songLinks === "spotify");
  const showPreview = theme === "song" && songLinks !== "none";

  return (
    <div className="space-y-3">
      {showHeader ? header : null}
      <ol ref={listRef} className="space-y-2">
        {results.map((row) => {
          const photoNumber = photoNumberByCandidateId?.[row.candidateId];
          const displayTitle =
            theme === "photo" && photoNumber != null
              ? formatPhotoLabel(photoNumber, row.title)
              : row.title;
          const spotify = spotifyByCandidateId?.[row.candidateId];
          return (
            <li
              key={row.candidateId}
              data-flip-id={row.candidateId}
              className={cn(
                "relative space-y-2 rounded-lg border px-3 py-2",
                "transition-[background-color,border-color,box-shadow] duration-700 ease-out",
                podiumRowClass(row.rank),
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    {theme === "photo" && row.url ? (
                      <PhotoCandidateImage
                        src={row.url}
                        alt={displayTitle}
                        layout="inline"
                      />
                    ) : null}
                    {theme !== "song" && theme !== "photo" && row.url ? (
                      <CandidateUrlPreview
                        url={row.url}
                        alt={displayTitle}
                        layout="inline"
                      />
                    ) : null}
                    <p className="min-w-0 truncate font-medium">
                      <span
                        className={cn(
                          podiumRankClass(row.rank),
                          "transition-[color,font-size] duration-700 ease-out",
                        )}
                      >
                        #{row.rank}
                      </span>{" "}
                      {displayTitle}
                    </p>
                    {showSpotify && spotify?.url ? (
                      <SpotifyTrackLink
                        href={spotify.url}
                        uri={spotify.uri}
                        openedKey={
                          contestId
                            ? `${contestId}:${row.candidateId}`
                            : row.candidateId
                        }
                      />
                    ) : null}
                  </div>
                  {row.artist ? (
                    <p className="text-sm text-muted-foreground">{row.artist}</p>
                  ) : null}
                  {birthdayLabelsByCandidateId?.[row.candidateId]?.length ? (
                    <p className="text-xs text-muted-foreground">
                      Birthday
                      {birthdayLabelsByCandidateId[row.candidateId]!.length > 1
                        ? "s"
                        : ""}
                      : {birthdayLabelsByCandidateId[row.candidateId]!.join(", ")}
                    </p>
                  ) : null}
                  {showPreview && row.url ? (
                    <SongPreviewPlayer previewUrl={row.url} />
                  ) : null}
                  {theme === "photo" && !row.url ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Photo removed after the presentation finished.
                    </p>
                  ) : null}
                  {theme !== "song" &&
                  theme !== "photo" &&
                  row.url &&
                  !isContestImageUrl(row.url) ? (
                    <CandidateUrlPreview url={row.url} alt={displayTitle} />
                  ) : null}
                </div>
                <div className="shrink-0 space-y-1 text-right">
                  {row.starAverage != null ? (
                    <StarMeter value={row.starAverage} className="justify-end" />
                  ) : null}
                  {row.starAverage == null || showStarPoints ? (
                    <p className="text-sm tabular-nums">
                      {latestBallotDeltaByCandidateId?.[row.candidateId] ? (
                        <span className="font-normal text-muted-foreground">
                          (+{latestBallotDeltaByCandidateId[row.candidateId]} pts){" "}
                        </span>
                      ) : null}
                      <span className="font-medium">{row.points} pts</span>
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
