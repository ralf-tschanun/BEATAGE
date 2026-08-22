"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  applyCandidateLivePatch,
  subscribeContestCandidates,
  subscribeContestMeta,
  type LiveCandidateRow,
} from "@/components/contest-live-refresh";
import { ContestSectionCard } from "@/components/contest-section-card";
import { EditCandidateControls } from "@/components/edit-candidate-controls";
import { NominateCandidateForm } from "@/components/nominate-candidate-form";
import { LiveColoredNominationStatus } from "@/components/nomination-status-badge";
import { PhotoCandidateImage, CandidateUrlPreview } from "@/components/photo-candidate-image";
import { SongPreviewPlayer } from "@/components/song-preview-player";
import { SpotifyTrackLink } from "@/components/spotify-track-link";
import {
  isParticipantNomination,
  type CandidateSource,
  type ContestTheme,
  type SongLinksMode,
} from "@/lib/plans";
import { isNominationsNotStartedYet } from "@/lib/contest-phase";

function isOwnNomination(
  candidate: LiveCandidateRow,
  currentUserId: string,
): boolean {
  return (
    candidate.nominator_user_id === currentUserId &&
    candidate.status !== "withdrawn" &&
    candidate.status !== "rejected"
  );
}

function isCuratedOwnNomination(
  candidate: LiveCandidateRow,
  candidateSource: CandidateSource,
  hostUserId: string | null,
): boolean {
  return !isParticipantNomination(
    {
      nominator_user_id: candidate.nominator_user_id,
      meta: candidate.nomination_origin
        ? { nomination_origin: candidate.nomination_origin }
        : null,
    },
    candidateSource,
    hostUserId,
  );
}

type NominateTabPanelProps = {
  contestId: string;
  joinCode: string;
  currentUserId: string;
  theme: ContestTheme;
  songLinks?: SongLinksMode;
  nominationsOpen: boolean;
  nominationDeadline: string | null;
  nominationDurationSeconds?: number | null;
  nominationsReopenedAt?: string | null;
  canShowNominateForm: boolean;
  remainingNominations: number | null;
  nextNominationNumber: number;
  nominateMode: "user" | "curated";
  candidateSource: CandidateSource;
  hostUserId: string | null;
  candidateTitleLabel: string;
  /** Own nominations (server snapshot); kept in sync via live refresh. */
  initialOwnCandidates: LiveCandidateRow[];
  /** Optional birthday forms rendered above the song form. */
  leadingContent?: ReactNode;
};

export function NominateTabPanel({
  contestId,
  joinCode,
  currentUserId,
  theme,
  songLinks = "preview",
  nominationsOpen,
  nominationDeadline,
  nominationDurationSeconds = null,
  nominationsReopenedAt = null,
  canShowNominateForm,
  remainingNominations,
  nextNominationNumber,
  nominateMode,
  candidateSource,
  hostUserId,
  candidateTitleLabel,
  initialOwnCandidates,
  leadingContent,
}: NominateTabPanelProps) {
  const [ownCandidates, setOwnCandidates] = useState(initialOwnCandidates);
  const [nomsOpen, setNomsOpen] = useState(nominationsOpen);
  const [nomsDeadline, setNomsDeadline] = useState(nominationDeadline);
  const [nomsReopenedAt, setNomsReopenedAt] = useState(nominationsReopenedAt);

  useEffect(() => {
    setOwnCandidates(initialOwnCandidates);
  }, [initialOwnCandidates]);

  useEffect(() => {
    setNomsOpen(nominationsOpen);
    setNomsDeadline(nominationDeadline);
    setNomsReopenedAt(nominationsReopenedAt);
  }, [nominationsOpen, nominationDeadline, nominationsReopenedAt]);

  useEffect(() => {
    return subscribeContestCandidates(contestId, (patch) => {
      setOwnCandidates((prev) => {
        const next = applyCandidateLivePatch(prev, patch, (row) => row, {
          prependNew: true,
        });
        if (!next) return prev;
        return next.filter((candidate) =>
          isOwnNomination(candidate, currentUserId),
        );
      });
    });
  }, [contestId, currentUserId]);

  useEffect(() => {
    return subscribeContestMeta(contestId, (meta) => {
      setNomsOpen(meta.nominationsOpen);
      setNomsDeadline(meta.nominationDeadline);
      setNomsReopenedAt(meta.nominationsReopenedAt);
    });
  }, [contestId]);

  const nominatedHeading = useMemo(() => {
    if (theme === "song") return "Nominated songs";
    if (theme === "photo") return "Nominated photos";
    return `Nominated ${candidateTitleLabel.toLowerCase()}s`;
  }, [theme, candidateTitleLabel]);

  /** Quota-facing count: curated seeds must not inflate the host's participant total. */
  const nominatedForQuotaCount = useMemo(() => {
    if (nominateMode === "curated") {
      return ownCandidates.filter((candidate) =>
        isCuratedOwnNomination(candidate, candidateSource, hostUserId),
      ).length;
    }
    return ownCandidates.filter(
      (candidate) =>
        !isCuratedOwnNomination(candidate, candidateSource, hostUserId),
    ).length;
  }, [ownCandidates, nominateMode, candidateSource, hostUserId]);

  const showForm = canShowNominateForm && nomsOpen;
  const nomsNotStarted = isNominationsNotStartedYet({
    nominationsOpen: nomsOpen,
    nominationDurationSeconds,
    nominationDeadline: nomsDeadline,
  });

  const statusDescription = (
    <>
      <LiveColoredNominationStatus
        contestId={contestId}
        initialOpen={nomsOpen}
        initialNominationDeadline={nomsDeadline}
        initialNominationDurationSeconds={nominationDurationSeconds}
        closedLabel="Nomination completed"
        notStartedLabel="Nomination not started yet"
      />
      {!nomsNotStarted && nominatedForQuotaCount > 0
        ? ` · ${nominatedForQuotaCount} nominated`
        : null}
      {!nomsNotStarted && nomsOpen
        ? remainingNominations === null
          ? " · unlimited left"
          : remainingNominations === 1
            ? " · 1 left"
            : ` · ${remainingNominations} left`
        : null}
    </>
  );

  return (
    <ContestSectionCard
      title="Nominate your Candidate(s)"
      description={statusDescription}
      contentClassName="space-y-5"
    >
      {leadingContent}

      {showForm ? (
        <NominateCandidateForm
          key={`nominate-${nomsOpen}-${nomsReopenedAt ?? "n"}`}
          contestId={contestId}
          joinCode={joinCode}
          remainingNominations={remainingNominations}
          nextNominationNumber={nextNominationNumber}
          theme={theme}
          mode={nominateMode}
          candidateTitleLabel={candidateTitleLabel}
          songLinks={songLinks}
          compactSongPick
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {nomsOpen
            ? "You cannot nominate in this contest."
            : nomsNotStarted
              ? "Nominations have not started yet."
              : "Nominations are closed."}
        </p>
      )}

      {ownCandidates.length > 0 ? (
        <div className="space-y-3">
          <div className="border-t border-border pt-4">
            <p className="text-sm font-semibold">{nominatedHeading}</p>
          </div>
          <ul className="space-y-2">
            {ownCandidates.map((candidate) => (
              <li
                key={candidate.id}
                className="space-y-2 rounded-lg border border-muted-foreground/20 bg-muted px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 font-medium">{candidate.title}</p>
                    {theme === "song" &&
                    songLinks === "spotify" &&
                    candidate.spotify_url ? (
                      <SpotifyTrackLink
                        href={candidate.spotify_url}
                        uri={candidate.spotify_uri}
                        openedKey={`${contestId}:${candidate.id}`}
                      />
                    ) : null}
                  </div>
                  {candidate.artist ? (
                    <p className="text-sm text-muted-foreground">
                      {candidate.artist}
                    </p>
                  ) : null}
                  {isCuratedOwnNomination(candidate, candidateSource, hostUserId) ? (
                    <p className="text-xs font-medium text-destructive">Curated</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Your nomination</p>
                  )}
                  {candidate.status === "pending" ? (
                    <p className="text-xs text-muted-foreground">
                      Pending reveal
                    </p>
                  ) : null}
                </div>
                {theme === "song" && songLinks !== "none" && candidate.url ? (
                  <SongPreviewPlayer previewUrl={candidate.url} label="" />
                ) : null}
                {theme === "photo" && candidate.url ? (
                  <PhotoCandidateImage
                    src={candidate.url}
                    alt={candidate.title}
                  />
                ) : null}
                {theme !== "song" && theme !== "photo" && candidate.url ? (
                  <CandidateUrlPreview
                    url={candidate.url}
                    alt={candidate.title}
                  />
                ) : null}
                {nomsOpen ? (
                  <EditCandidateControls
                    contestId={contestId}
                    joinCode={joinCode}
                    theme={theme}
                    candidate={{
                      id: candidate.id,
                      title: candidate.title,
                      artist: candidate.artist,
                      url: candidate.url,
                      description: candidate.description ?? null,
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </ContestSectionCard>
  );
}
