"use client";

import { VotingBallot, type BallotCandidate } from "@/components/voting-ballot";
import type { ContestTheme, ScoringModelId, VoteMutability } from "@/lib/plans";
import { ballotsForQuestion } from "@/lib/plans";

type ContestQuestion = { id: string; name: string };

type EmbeddedContestBallotProps = {
  contestId: string;
  joinCode: string;
  scoringModel: ScoringModelId;
  theme: ContestTheme;
  candidates: BallotCandidate[];
  excludedCandidateIds?: string[];
  myRankings: string[] | null;
  myRankingsByQuestion: Record<string, string[]>;
  contestQuestions: ContestQuestion[];
  voteMutability: VoteMutability;
  votingClosesAt?: string | null;
  allowEdit?: boolean;
};

/**
 * Your ballot above the candidates list (Best 5+ / long rankings).
 * Title only — no topic labels or intro copy.
 */
export function EmbeddedContestBallot({
  contestId,
  joinCode,
  scoringModel,
  theme,
  candidates,
  excludedCandidateIds = [],
  myRankings,
  myRankingsByQuestion,
  contestQuestions,
  voteMutability,
  votingClosesAt = null,
  allowEdit = true,
}: EmbeddedContestBallotProps) {
  const hasQuestions = contestQuestions.length > 0;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-sm font-semibold">
        {contestQuestions.length > 1 ? "Your ballots" : "Your ballot"}
      </p>
      {hasQuestions ? (
        <div className="space-y-4">
          {contestQuestions.map((question) => {
            const questionCandidates = ballotsForQuestion(
              candidates,
              question.id,
            );
            // Prefer question-scoped candidates; fall back to unscoped pool.
            const pool =
              questionCandidates.length > 0
                ? questionCandidates
                : candidates.filter((c) => !c.questionId);
            const rankings = myRankingsByQuestion[question.id] ?? null;
            const locked =
              Boolean(rankings?.length) &&
              (voteMutability === "locked_on_submit" || !allowEdit);
            return (
              <VotingBallot
                key={question.id}
                contestId={contestId}
                joinCode={joinCode}
                scoringModel={scoringModel}
                theme={theme}
                candidates={pool}
                excludedCandidateIds={excludedCandidateIds}
                existingRankings={rankings}
                locked={locked}
                voteMutability={voteMutability}
                allowEdit={allowEdit}
                votingClosesAt={votingClosesAt}
                questionId={question.id}
                hideQuestionTitle
                hideIntro
              />
            );
          })}
        </div>
      ) : (
        <VotingBallot
          contestId={contestId}
          joinCode={joinCode}
          scoringModel={scoringModel}
          theme={theme}
          candidates={candidates}
          excludedCandidateIds={excludedCandidateIds}
          existingRankings={myRankings}
          locked={
            Boolean(myRankings?.length) &&
            (voteMutability === "locked_on_submit" || !allowEdit)
          }
          voteMutability={voteMutability}
          allowEdit={allowEdit}
          votingClosesAt={votingClosesAt}
          hideIntro
        />
      )}
    </div>
  );
}
