import { CHART_COUNTRY_OPTIONS } from "@/lib/charts";
import {
  answerYearModeLabel,
  isLiveQuizSource,
  quizSourceLabel,
  scoringModeLabel,
  presentsLeaderboardAtEnd,
  QUIZ_LEADERBOARD_REVEAL_OPTIONS,
  type BeatageQuizSettings,
  type ChartCountryCode,
} from "@/lib/quiz-settings";

type QuizRulesContentProps = {
  joinCode: string;
  createdAt: string | null;
  source: string;
  settings: BeatageQuizSettings;
  trackCount: number;
};

function guessPeriodLabel(settings: BeatageQuizSettings): string {
  if (settings.guessPeriod === "until_next_track") return "Until the next track";
  if (settings.guessPeriod === "fixed_seconds") {
    const seconds = settings.guessPeriodSeconds ?? 15;
    return `Timed (${seconds}s)`;
  }
  return "Host closes manually";
}

function guessMutabilityLabel(settings: BeatageQuizSettings): string {
  return settings.guessMutability === "locked_on_submit"
    ? "Locked on submit"
    : "Editable until the round closes";
}

function roundRevealLabel(settings: BeatageQuizSettings): string {
  return settings.roundReveal === "live" ? "Live" : "After the round";
}

function overallRevealLabel(settings: BeatageQuizSettings): string {
  if (settings.overallReveal === "immediate") {
    return QUIZ_LEADERBOARD_REVEAL_OPTIONS.immediate.label;
  }
  if (settings.overallReveal === "last_to_first") {
    return QUIZ_LEADERBOARD_REVEAL_OPTIONS.last_to_first.label;
  }
  return "After the quiz (no staged presentation)";
}

function chartCountryLabel(code: ChartCountryCode): string {
  return CHART_COUNTRY_OPTIONS[code]?.label ?? code;
}

export function QuizRulesContent({
  joinCode,
  createdAt,
  source,
  settings,
  trackCount,
}: QuizRulesContentProps) {
  const scoring = settings.scoringModes.map(scoringModeLabel).join(", ");
  const charts = settings.chartCountries.map(chartCountryLabel).join(", ");
  const isLive = isLiveQuizSource(source);

  return (
    <div className="space-y-2 text-sm">
      <p>
        <span className="text-muted-foreground">Code:</span>{" "}
        <span className="font-mono font-semibold tracking-wider">{joinCode}</span>
      </p>
      {createdAt ? (
        <p>
          <span className="text-muted-foreground">Created at:</span>{" "}
          {new Date(createdAt).toLocaleString()}
        </p>
      ) : null}
      <p>
        <span className="text-muted-foreground">Mode:</span> {quizSourceLabel(source)}
        {!isLive && trackCount > 0
          ? ` · ${trackCount} song${trackCount === 1 ? "" : "s"}`
          : null}
        {source === "lastfm_live" && settings.lastfmUsername
          ? ` · Last.fm @${settings.lastfmUsername}`
          : null}
      </p>
      <p>
        <span className="text-muted-foreground">Answer year:</span>{" "}
        {answerYearModeLabel(settings.answerYearMode)}
      </p>
      {settings.scoringModes.includes("chart_was_one") ? (
        <p>
          <span className="text-muted-foreground">Charts:</span> {charts}
        </p>
      ) : null}
      <p>
        <span className="text-muted-foreground">Scoring:</span> {scoring}
        {settings.scoringModes.includes("year_range")
          ? settings.yearRangeTolerance === 0
            ? " · exact year = 1 yr"
            : ` · ±${settings.yearRangeTolerance} years`
          : ""}
        {settings.scoringModes.includes("year_distance")
          ? " · lowest score wins · no guess: worst miss + 2 (max 20)"
          : " · highest score wins"}
        {settings.scoringModes.includes("chart_was_one") &&
        (settings.scoringModes.includes("year_distance") ||
          settings.scoringModes.includes("year_range"))
          ? settings.scoringModes.includes("year_distance")
            ? " · #1 combo: +0 / +1 / +2 (correct / skip / wrong)"
            : " · #1 combo: +2 / +1 / +0 (correct / skip / wrong)"
          : null}
      </p>
      <p>
        <span className="text-muted-foreground">Host role:</span>{" "}
        {settings.hostParticipates
          ? "Host also plays along"
          : "Host is admin-only and does not guess"}
      </p>
      <p>
        <span className="text-muted-foreground">Guess window:</span>{" "}
        {guessPeriodLabel(settings)}
      </p>
      <p>
        <span className="text-muted-foreground">Guess changes:</span>{" "}
        {guessMutabilityLabel(settings)}
      </p>
      <p>
        <span className="text-muted-foreground">Title & artist:</span>{" "}
        {settings.showTitleArtist ? "shown during the round" : "hidden until reveal"}
      </p>
      <p>
        <span className="text-muted-foreground">Correct year:</span>{" "}
        {settings.showCorrectAnswer ? "shown after the round" : "not shown"}
      </p>
      <p>
        <span className="text-muted-foreground">Overall results:</span>{" "}
        {presentsLeaderboardAtEnd(settings)
          ? "hidden during play (presented at the end)"
          : settings.showOverallResults
            ? "live leaderboard shown during play"
            : settings.hostParticipates
              ? "hidden during play"
              : "hidden for players (host sees the board while not playing along)"}
      </p>
      <p>
        <span className="text-muted-foreground">Result details:</span>{" "}
        {settings.showResultDetails
          ? settings.showOthersInPastResults
            ? "previous rounds expand to full results for everyone"
            : "previous rounds expand; participants only see their own guess"
          : "previous rounds show your years only"}
      </p>
      {isLive ? (
        <p>
          <span className="text-muted-foreground">Auto interrupt:</span>{" "}
          after {settings.autoInterruptAfterEmptyRounds} songs without guesses
        </p>
      ) : null}
      <p>
        <span className="text-muted-foreground">Speed bonus:</span>{" "}
        {settings.speedBonus ? "on" : "off"}
      </p>
      <p>
        <span className="text-muted-foreground">Round reveal:</span>{" "}
        {roundRevealLabel(settings)}
      </p>
      <p>
        <span className="text-muted-foreground">Overall standings:</span>{" "}
        {overallRevealLabel(settings)}
      </p>
    </div>
  );
}
