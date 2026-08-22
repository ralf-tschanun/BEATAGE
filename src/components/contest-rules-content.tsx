import { CloneContestButton } from "@/components/clone-contest-button";
import { EditContestSettings } from "@/components/edit-contest-settings";
import { CHART_COUNTRY_OPTIONS, type ChartCountry } from "@/lib/charts";
import { formatBirthdayOffsetLabel } from "@/lib/birthday-offset";
import { formatNominationDuration } from "@/lib/nomination-duration";
import {
  BALLOT_REVEAL_ORDER_OPTIONS,
  CANDIDATE_REVEALS,
  CANDIDATE_SORT_OPTIONS,
  CANDIDATE_SOURCES,
  CONTEST_THEMES,
  NOMINATOR_RANKING_WHEN_OPTIONS,
  NOMINATOR_RESULTS_REVEAL_OPTIONS,
  RESULTS_REVEAL_OPTIONS,
  SCORING_MODELS,
  SONG_LINKS_OPTIONS,
  VOTE_MUTABILITY_OPTIONS,
  isStarRatingModel,
  type BallotRevealOrder,
  type CandidateReveal,
  type CandidateSort,
  type CandidateSource,
  type ContestTheme,
  type NominationKind,
  type NominatorRankingWhen,
  type NominatorResultsReveal,
  type PlanId,
  type ResultsReveal,
  type ScoringModelId,
  type SongLinksMode,
  type VoteMutability,
  type VotingCloseMode,
} from "@/lib/plans";

type ContestRulesContentProps = {
  joinCode: string;
  theme: ContestTheme;
  createdAt: string;
  nominationKind: NominationKind;
  chartCountry: ChartCountry;
  isCuratedBirthday: boolean;
  isHost: boolean;
  hostParticipates: boolean;
  source: CandidateSource;
  curatedBirthdayCount: number;
  maxCandidates: number | null;
  maxNominationsPerParticipant: number | null;
  nominationDeadline: string | null;
  nominationDurationSeconds: number | null;
  allowDuplicateCandidates: boolean;
  reveal: CandidateReveal;
  songLinks: SongLinksMode;
  candidateTitle: string;
  candidateSort: CandidateSort;
  scoring: ScoringModelId;
  showStarPoints: boolean;
  showNominees: boolean;
  resultsReveal: ResultsReveal;
  ballotRevealOrder: BallotRevealOrder;
  resultsAnonymous: boolean;
  nominatorRanking: boolean;
  nominatorRankingWhen: NominatorRankingWhen;
  nominatorResultsReveal: NominatorResultsReveal;
  allowVoteOwnNominations: boolean;
  voteMutability: VoteMutability;
  votingCloseMode: VotingCloseMode;
  votingClosesAt: string | null;
  birthdayOffsetAmount: number;
  birthdayOffsetUnit: "months" | "years";
  hostPlanId: PlanId;
  editSettings: React.ComponentProps<typeof EditContestSettings>["contest"];
};

function formatNominationCloseLabel(
  nominationDeadline: string | null,
  nominationDurationSeconds: number | null,
): string {
  if (
    typeof nominationDurationSeconds === "number" &&
    nominationDurationSeconds >= 1
  ) {
    return `Timed window (${formatNominationDuration(nominationDurationSeconds)}) when host starts nominations`;
  }
  if (nominationDeadline) {
    return `Scheduled · ${new Date(nominationDeadline).toLocaleString()}`;
  }
  return "Host closes manually";
}

function showParticipantNomineeSetting(
  nominationKind: NominationKind,
  source: CandidateSource,
): boolean {
  return (
    nominationKind !== "birthday" &&
    (source === "user_single" ||
      source === "user_multiple" ||
      source === "combined")
  );
}

export function ContestRulesContent({
  joinCode,
  theme,
  createdAt,
  nominationKind,
  chartCountry,
  isCuratedBirthday,
  isHost,
  hostParticipates,
  source,
  curatedBirthdayCount,
  maxCandidates,
  maxNominationsPerParticipant,
  nominationDeadline,
  nominationDurationSeconds,
  allowDuplicateCandidates,
  reveal,
  songLinks,
  candidateTitle,
  candidateSort,
  scoring,
  showStarPoints,
  showNominees,
  resultsReveal,
  ballotRevealOrder,
  resultsAnonymous,
  nominatorRanking,
  nominatorRankingWhen,
  nominatorResultsReveal,
  allowVoteOwnNominations,
  voteMutability,
  votingCloseMode,
  votingClosesAt,
  birthdayOffsetAmount,
  birthdayOffsetUnit,
  hostPlanId,
  editSettings,
}: ContestRulesContentProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2 text-sm">
        <p>
          <span className="text-muted-foreground">Code:</span>{" "}
          <span className="font-mono font-semibold tracking-wider">
            {joinCode}
          </span>
        </p>
        <p>
          <span className="text-muted-foreground">Theme:</span>{" "}
          {CONTEST_THEMES[theme]?.label ?? theme}
          {nominationKind === "birthday" ? " · Birthday Song Contest" : ""}
        </p>
        <p>
          <span className="text-muted-foreground">Created at:</span>{" "}
          {new Date(createdAt).toLocaleString()}
        </p>
        {nominationKind === "birthday" ? (
          <>
            <p>
              <span className="text-muted-foreground">Chart:</span>{" "}
              {CHART_COUNTRY_OPTIONS[chartCountry].label} ·{" "}
              {isCuratedBirthday
                ? "host adds names and birth dates; chart #1 hits are looked up on release. Participants vote without knowing whose birthday each song is."
                : "participants submit a birthday; that week's #1 is nominated privately. Shared hits share points."}
            </p>
            <p>
              <span className="text-muted-foreground">Chart date:</span>{" "}
              {formatBirthdayOffsetLabel({
                amount: birthdayOffsetAmount,
                unit: birthdayOffsetUnit,
              })}
              {isHost ? " · change under Edit settings" : ""}
            </p>
          </>
        ) : null}
        <p>
          <span className="text-muted-foreground">Host role:</span>{" "}
          {hostParticipates
            ? "Host also participates"
            : "Host is admin-only and cannot nominate or vote"}
        </p>
        <p>
          <span className="text-muted-foreground">Candidates:</span>{" "}
          {isCuratedBirthday
            ? "Curated birthday chart lookup (host adds people)"
            : nominationKind === "birthday"
              ? "Birthday chart lookup (one birthday per person)"
              : (CANDIDATE_SOURCES[source]?.label ?? source)}
        </p>
        <p>
          <span className="text-muted-foreground">Nominations / person:</span>{" "}
          {isCuratedBirthday
            ? `${curatedBirthdayCount} people added by host${
                maxCandidates ? ` (max ${maxCandidates})` : ""
              }`
            : nominationKind === "birthday"
              ? "1 birthday"
              : (maxNominationsPerParticipant ?? "unlimited")}
        </p>
        {nominationKind !== "birthday" &&
        !isCuratedBirthday &&
        source !== "curated" ? (
          <p>
            <span className="text-muted-foreground">Nominations close:</span>{" "}
            {formatNominationCloseLabel(
              nominationDeadline,
              nominationDurationSeconds,
            )}
          </p>
        ) : null}
        {theme === "song" ? (
          <p>
            <span className="text-muted-foreground">Duplicates:</span>{" "}
            {allowDuplicateCandidates ? "allowed" : "not allowed"}
          </p>
        ) : null}
        {theme === "generic" && source !== "curated" ? (
          <p>
            <span className="text-muted-foreground">Candidate description:</span>{" "}
            {candidateTitle}
          </p>
        ) : null}
        <p>
          <span className="text-muted-foreground">Reveal:</span>{" "}
          {CANDIDATE_REVEALS[reveal]?.label ?? reveal}
        </p>
        {theme === "song" ? (
          <p>
            <span className="text-muted-foreground">Song links:</span>{" "}
            {SONG_LINKS_OPTIONS[songLinks]?.label ?? songLinks}
          </p>
        ) : null}
        <p>
          <span className="text-muted-foreground">Candidate order:</span>{" "}
          {CANDIDATE_SORT_OPTIONS[
            candidateSort as keyof typeof CANDIDATE_SORT_OPTIONS
          ]?.label ?? candidateSort}
        </p>
        <p>
          <span className="text-muted-foreground">Scoring:</span>{" "}
          {SCORING_MODELS[scoring]?.label ?? scoring} (
          {SCORING_MODELS[scoring]?.description})
        </p>
        {isStarRatingModel(scoring) ? (
          <p>
            <span className="text-muted-foreground">Show point totals:</span>{" "}
            {showStarPoints ? "yes" : "no"}
          </p>
        ) : null}
        {showParticipantNomineeSetting(nominationKind, source) ? (
          <p>
            <span className="text-muted-foreground">Show nominees:</span>{" "}
            {showNominees ? "yes" : "no"}
          </p>
        ) : null}
        <p>
          <span className="text-muted-foreground">Results:</span>{" "}
          {RESULTS_REVEAL_OPTIONS[resultsReveal]?.label ?? resultsReveal}
          {resultsReveal === "by_participant"
            ? ` · ${BALLOT_REVEAL_ORDER_OPTIONS[ballotRevealOrder]?.label ?? ballotRevealOrder}`
            : ""}
        </p>
        <p>
          <span className="text-muted-foreground">Anonymous results:</span>{" "}
          {resultsAnonymous ? "yes" : "no"}
        </p>
        <p>
          <span className="text-muted-foreground">Nominator ranking:</span>{" "}
          {nominatorRanking
            ? `${NOMINATOR_RANKING_WHEN_OPTIONS[nominatorRankingWhen]?.label ?? nominatorRankingWhen}${
                nominatorRankingWhen !== "parallel"
                  ? ` · ${NOMINATOR_RESULTS_REVEAL_OPTIONS[nominatorResultsReveal]?.label ?? nominatorResultsReveal}`
                  : ""
              }`
            : "Off"}
        </p>
        <p>
          <span className="text-muted-foreground">Own nominations on ballot:</span>{" "}
          {allowVoteOwnNominations ? "allowed" : "not allowed"}
        </p>
        <p>
          <span className="text-muted-foreground">Vote changes:</span>{" "}
          {VOTE_MUTABILITY_OPTIONS[voteMutability]?.label ?? voteMutability}
        </p>
        <p>
          <span className="text-muted-foreground">Voting ends:</span>{" "}
          {votingCloseMode === "scheduled" && votingClosesAt
            ? new Date(votingClosesAt).toLocaleString()
            : "manually by host"}
        </p>
      </div>
      {isHost ? (
        <div className="space-y-4">
          <CloneContestButton
            contestId={editSettings.id}
            contestTitle={editSettings.title}
            candidateLabel={candidateTitle}
          />
          <EditContestSettings planId={hostPlanId} contest={editSettings} />
        </div>
      ) : null}
    </div>
  );
}
