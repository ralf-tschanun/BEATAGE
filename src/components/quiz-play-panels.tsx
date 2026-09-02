"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addCuratedTrackAction,
  advanceLeaderboardRevealAction,
  closeRoundAction,
  excludeRoundAction,
  finishQuizAction,
  includeRoundAction,
  skipRoundAction,
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
import { AutoLastfmHostControls } from "@/components/auto-lastfm-host-controls";
import { AutoSpotifyHostControls } from "@/components/auto-spotify-host-controls";
import { CollapsibleCard, ACTIVE_PANEL_CARD_CLASS } from "@/components/collapsible-card";
import { FadeMount } from "@/components/fade-mount";
import { SongPickFields } from "@/components/song-pick-fields";
import { SongPreviewPlayer } from "@/components/song-preview-player";
import { SpotifyTrackLink } from "@/components/spotify-track-link";
import { useFlipList } from "@/components/use-flip-list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CaretDownIcon, CheckIcon, XIcon } from "@phosphor-icons/react";
import type { PlanId } from "@/lib/quiz-plans";
import { isQuizPlanLimitError } from "@/lib/quiz-plan-limits";
import { chartCountriesShortLabel, chartWasOneLabel } from "@/lib/charts";
import { QuizPlanLimitPrompt } from "@/components/quiz-plan-limit-prompt";
import { QuizTeamsPanel } from "@/components/quiz-teams-panel";
import { podiumRankClass, podiumRowClass } from "@/lib/result-podium-styles";
import {
  applyQuizLeaderboardReveal,
  DEFAULT_QUIZ_SETTINGS,
  formatRoundLabel,
  isLiveQuizSource,
  isInactivityQuizInterrupt,
  isQuizLeaderboardRevealComplete,
  presentsLeaderboardAtEnd,
  roundOutcomeLabel,
  scoringCombinesChart,
  scoringLowWins,
  scoringUnitLabel,
  type BeatageQuizSettings,
} from "@/lib/quiz-settings";
import { scrollToSection } from "@/lib/scroll";
import { cn } from "@/lib/utils";
import {
  formatTeamScore,
  scoringRoster,
  teamsOfficialStartBlockReason,
  type QuizRosterMember,
  type QuizTeamInfo,
  type TeamRoundGroup,
} from "@/lib/quiz-teams";
import type {
  CuratedTrackRow,
  GuessRow,
  LeaderboardRow,
  PastRoundRow,
  RoundRow,
} from "@/lib/quizzes/play-state";
import { useWizardInputFocus } from "@/lib/wizard-input-focus";

const initial: QuizRoundActionState = null;

/** How long the correct-answer card stays up after a round is revealed (incl. overlap with the next guess). */
const RESULT_HOLD_MS = 20_000;

/** Host open-in-Spotify: prefer track id, else search by title + artist. */
function spotifyOpenForHostTrack(opts: {
  spotifyTrackId?: string | null;
  trackName?: string | null;
  artistName?: string | null;
}): { href: string; uri: string | null } | null {
  const id = opts.spotifyTrackId?.trim();
  if (id) {
    return {
      href: `https://open.spotify.com/track/${id}`,
      uri: `spotify:track:${id}`,
    };
  }
  const query = [opts.trackName?.trim(), opts.artistName?.trim()]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!query) return null;
  return {
    href: `https://open.spotify.com/search/${encodeURIComponent(query)}`,
    uri: `spotify:search:${encodeURIComponent(query)}`,
  };
}

function ChartGuessVerdict({
  guessed,
  wasNumberOne,
}: {
  guessed: boolean | null;
  wasNumberOne: boolean | null;
}) {
  if (guessed == null || wasNumberOne == null) return null;
  const correct = guessed === wasNumberOne;
  return correct ? (
    <CheckIcon
      className="inline size-3.5 shrink-0 text-emerald-600"
      weight="bold"
      aria-label="correct"
    />
  ) : (
    <XIcon
      className="inline size-3.5 shrink-0 text-red-600"
      weight="bold"
      aria-label="wrong"
    />
  );
}

function RoundGuessesList({
  guesses,
  emptyLabel = "No guesses this round.",
  showChartGuess = false,
  wasNumberOne = null,
  currentUserId = null,
  scoreUnit = "yr",
}: {
  guesses: GuessRow[];
  emptyLabel?: string;
  showChartGuess?: boolean;
  wasNumberOne?: boolean | null;
  currentUserId?: string | null;
  scoreUnit?: "yr" | "pt";
}) {
  return (
    <ul className="divide-y divide-border/60 text-sm">
      {guesses.length > 0 ? (
        guesses.map((g) => (
          <li key={g.user_id} className="flex min-w-0 items-center justify-between gap-3 py-2">
            <span className="min-w-0 truncate font-medium">
              {g.display_name}
              {currentUserId && g.user_id === currentUserId ? (
                <span className="ml-2 text-xs text-muted-foreground">(You)</span>
              ) : null}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
              {g.guessed_year ?? "no guess"}
              {showChartGuess ? (
                <>
                  {g.guessed_was_number_one == null
                    ? " · #1: —"
                    : g.guessed_was_number_one
                      ? " · #1: yes"
                      : " · #1: no"}
                  <ChartGuessVerdict
                    guessed={g.guessed_was_number_one}
                    wasNumberOne={wasNumberOne}
                  />
                </>
              ) : null}
              {" · "}
              {g.points_total} {scoreUnit}
            </span>
          </li>
        ))
      ) : (
        <li className="py-2 text-muted-foreground">{emptyLabel}</li>
      )}
    </ul>
  );
}

function TeamRoundGuessesList({
  groups,
  emptyLabel = "No team results this round.",
  showChartGuess = false,
  wasNumberOne = null,
  currentUserId = null,
  scoreUnit = "yr",
}: {
  groups: TeamRoundGroup[];
  emptyLabel?: string;
  showChartGuess?: boolean;
  wasNumberOne?: boolean | null;
  currentUserId?: string | null;
  scoreUnit?: "yr" | "pt";
}) {
  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-3">
      {groups.map((group) => (
        <li
          key={group.team_id}
          className="rounded-xl border border-border/60 px-3 py-2"
        >
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium">
              {group.team_name}
              {group.is_own_team ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  (your team)
                </span>
              ) : null}
            </span>
            <span className="shrink-0 font-medium tabular-nums">
              {formatTeamScore(group.average_points)} {scoreUnit}
            </span>
          </div>
          {group.aggregateOnly ? (
            <p className="mt-1 text-xs text-muted-foreground">Team average</p>
          ) : (
            <RoundGuessesList
              guesses={group.guesses}
              showChartGuess={showChartGuess}
              wasNumberOne={wasNumberOne}
              currentUserId={currentUserId}
              scoreUnit={scoreUnit}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

function rowIncludesUser(row: LeaderboardRow, userId: string | null): boolean {
  if (!userId) return false;
  if (row.kind === "team") {
    return Boolean(row.members?.some((member) => member.user_id === userId));
  }
  return row.user_id === userId;
}

function leaderboardMemberLine(row: LeaderboardRow): string | null {
  if (row.kind !== "team" || !row.members?.length) return null;
  return row.members.map((member) => member.display_name).join(" · ");
}

function RoundCorrectYear({
  round,
  show,
  showChartOne,
  chartCountries,
}: {
  round: RoundRow;
  show: boolean;
  showChartOne?: boolean;
  chartCountries?: BeatageQuizSettings["chartCountries"];
}) {
  if (!show && !showChartOne) return null;
  return (
    <div className="space-y-1">
      {show ? (
        <p className="text-sm font-medium text-emerald-700">
          Correct release year:{" "}
          <span className="font-bold">{round.correct_release_year ?? "—"}</span>
          {round.original_release_year &&
          round.original_release_year !== round.correct_release_year
            ? ` (original ${round.original_release_year})`
            : null}
        </p>
      ) : null}
      {showChartOne && typeof round.chart_was_number_one === "boolean" ? (
        <p className="text-sm font-medium text-emerald-700">
          {chartWasOneLabel(chartCountries)}:{" "}
          <span className="font-bold">
            {round.chart_was_number_one ? "yes" : "no"}
          </span>
        </p>
      ) : null}
    </div>
  );
}

type QuizPlayPanelsProps = {
  quizId: string;
  joinCode: string;
  isHost: boolean;
  /** curated | spotify_live | lastfm_live | … — drives live auto host UI. */
  quizSource?: string;
  memberCount: number;
  tracks: CuratedTrackRow[];
  /** Total curated tracks — required when tracks[] is empty for live / non-host. */
  trackCount?: number;
  currentRoundNumber: number;
  activeRound: RoundRow | null;
  resultRound: RoundRow | null;
  pastRounds?: PastRoundRow[];
  roundGuesses: GuessRow[];
  myGuessYear: number | null;
  myGuessWasNumberOne?: boolean | null;
  leaderboard: LeaderboardRow[];
  roster?: QuizRosterMember[];
  teams?: QuizTeamInfo[];
  teamsLocked?: boolean;
  resultTeamGroups?: TeamRoundGroup[];
  quizStatus: string;
  maxCuratedTracks: number | null;
  /** Participant cap for this quiz; null = unlimited. */
  maxMembers?: number | null;
  settings?: BeatageQuizSettings;
  autoInterrupted?: boolean;
  autoEmptyStreak?: number;
  /** False while live quiz is still in pre-round warm-up. */
  quizStarted?: boolean;
  /** Host-controlled end presentation progress (0 = not started). */
  leaderboardRevealStep?: number;
  liveOpenMode?: "automatic" | "manual";
  liveDeferredTrackKey?: string | null;
  /** Guest sessions need an email account before Polar unlock checkout. */
  isAnonymous?: boolean;
  currentUserId?: string | null;
  hostUserId?: string | null;
  /** Host billing plan — unlock / change-plan prompts. */
  planId?: PlanId;
  /** True when this quiz was unlocked. */
  unlocked?: boolean;
};

export function QuizPlayPanels({
  quizId,
  joinCode,
  isHost,
  quizSource = "curated",
  memberCount: memberCountProp,
  tracks: tracksProp,
  trackCount: trackCountProp,
  currentRoundNumber: currentRoundNumberProp,
  activeRound: activeRoundProp,
  resultRound: resultRoundProp,
  pastRounds: pastRoundsProp = [],
  roundGuesses: roundGuessesProp,
  myGuessYear: myGuessYearProp,
  myGuessWasNumberOne: myGuessWasNumberOneProp = null,
  leaderboard: leaderboardProp,
  roster: rosterProp = [],
  teams: teamsProp = [],
  teamsLocked: teamsLockedProp = false,
  resultTeamGroups: resultTeamGroupsProp = [],
  quizStatus: quizStatusProp,
  maxCuratedTracks: maxCuratedTracksProp,
  maxMembers: maxMembersProp = null,
  settings: settingsProp = DEFAULT_QUIZ_SETTINGS,
  autoInterrupted: autoInterruptedProp = false,
  autoEmptyStreak: autoEmptyStreakProp = 0,
  quizStarted: quizStartedProp = true,
  leaderboardRevealStep: leaderboardRevealStepProp = 0,
  liveOpenMode: liveOpenModeProp = "automatic",
  liveDeferredTrackKey: liveDeferredTrackKeyProp = null,
  isAnonymous = false,
  currentUserId = null,
  hostUserId = null,
  planId = "free",
  unlocked = false,
}: QuizPlayPanelsProps) {
  const router = useRouter();
  const lastSyncIdRef = useRef<string | null>(null);
  const [addState, addAction, addPending] = useActionState(addCuratedTrackAction, initial);
  const [startState, startAction, startPending] = useActionState(startRoundAction, initial);
  const [guessState, setGuessState] = useState<QuizRoundActionState>(initial);
  const [guessBusy, setGuessBusy] = useState(false);
  const [closeState, closeAction, closePending] = useActionState(closeRoundAction, initial);
  const [skipState, skipAction, skipPending] = useActionState(skipRoundAction, initial);
  const [excludeState, excludeAction, excludePending] = useActionState(
    excludeRoundAction,
    initial,
  );
  const [includeState, includeAction, includePending] = useActionState(
    includeRoundAction,
    initial,
  );
  const [finishState, finishAction, finishPending] = useActionState(finishQuizAction, initial);
  const [revealState, setRevealState] = useState<QuizRoundActionState>(initial);
  const [revealBusy, setRevealBusy] = useState(false);
  const [showAddTrack, setShowAddTrack] = useState(false);
  const [draftTrack, setDraftTrack] = useState({
    title: "",
    artist: "",
    previewUrl: "",
    releaseYear: null as number | null,
  });
  const { focusById } = useWizardInputFocus([showAddTrack]);

  useEffect(() => {
    if (!showAddTrack) return;
    focusById("host-add-track-search", { keyboardSafe: true });
  }, [showAddTrack, focusById]);

  const [expandedPastRoundId, setExpandedPastRoundId] = useState<string | null>(
    null,
  );
  const [skipConfirmOpen, setSkipConfirmOpen] = useState(false);
  const [excludeConfirmRoundId, setExcludeConfirmRoundId] = useState<string | null>(
    null,
  );
  const [includeConfirmRoundId, setIncludeConfirmRoundId] = useState<string | null>(
    null,
  );

  const isLive = isLiveQuizSource(quizSource);
  const isLastfmLive = quizSource === "lastfm_live";
  const isAutoSpotify = quizSource === "spotify_live";

  // Live snapshot (MyContest pattern) — client fetch beats waiting on RSC alone.
  const [live, setLive] = useState<QuizPlaySnapshot>(() => ({
    currentRoundNumber: currentRoundNumberProp,
    tracks: tracksProp,
    trackCount: trackCountProp ?? tracksProp.length,
    activeRound: activeRoundProp,
    resultRound: resultRoundProp,
    pastRounds: pastRoundsProp,
    roundGuesses: roundGuessesProp,
    myGuessYear: myGuessYearProp,
    myGuessWasNumberOne: myGuessWasNumberOneProp,
    leaderboard: leaderboardProp,
    memberCount: memberCountProp,
    roster: rosterProp,
    teams: teamsProp,
    teamsLocked: teamsLockedProp,
    resultTeamGroups: resultTeamGroupsProp,
    quizStatus: quizStatusProp,
    maxCuratedTracks: maxCuratedTracksProp,
    settings: settingsProp,
    autoInterrupted: autoInterruptedProp,
    autoEmptyStreak: autoEmptyStreakProp,
    quizStarted: quizStartedProp,
    leaderboardRevealStep: leaderboardRevealStepProp,
  }));

  const tracks = live.tracks;
  const trackCount = live.trackCount || tracks.length;
  const currentRoundNumber = live.currentRoundNumber;
  const activeRound = live.activeRound;
  const resultRound = live.resultRound;
  const pastRounds = live.pastRounds ?? [];
  const roundGuesses = live.roundGuesses;
  const myGuessYear = live.myGuessYear;
  const myGuessWasNumberOne = live.myGuessWasNumberOne ?? null;
  const leaderboard = live.leaderboard;
  const roster = live.roster ?? rosterProp;
  const teams = live.teams ?? teamsProp;
  const teamsLocked = live.teamsLocked ?? teamsLockedProp;
  const resultTeamGroups = live.resultTeamGroups ?? resultTeamGroupsProp;
  const memberCount = live.memberCount;
  const quizStatus = live.quizStatus;
  const isFinished = quizStatus === "finished" || quizStatus === "expired";
  const maxCuratedTracks = live.maxCuratedTracks;
  const settings = live.settings ?? settingsProp;
  const autoInterrupted = live.autoInterrupted ?? autoInterruptedProp;
  const autoEmptyStreak = live.autoEmptyStreak ?? autoEmptyStreakProp;
  const quizStarted = live.quizStarted ?? quizStartedProp;
  const leaderboardRevealStep =
    live.leaderboardRevealStep ?? leaderboardRevealStepProp;
  const presentAtEnd = presentsLeaderboardAtEnd(settings);
  const presentationComplete = isQuizLeaderboardRevealComplete(
    settings.overallReveal,
    leaderboardRevealStep,
    leaderboard.length,
  );
  const teamsBlockOfficialStart =
    settings.teamsEnabled && !teamsLocked
      ? teamsOfficialStartBlockReason({
          teamsEnabled: true,
          teams,
          scoringMembers: scoringRoster(roster, settings.hostParticipates),
        })
      : null;
  const rankedLeaderboard = leaderboard.map((row, index) => ({
    ...row,
    rank: index + 1,
  }));
  const visibleLeaderboard =
    isFinished && presentAtEnd
      ? applyQuizLeaderboardReveal(
          settings.overallReveal,
          leaderboardRevealStep,
          rankedLeaderboard,
        )
      : rankedLeaderboard;
  // Running board during play: same visibility as participants, except a
  // non-playing host always sees it (to run the room) — unless the board is
  // reserved for end-of-quiz presentation.
  const showRunningLeaderboard =
    !isFinished &&
    leaderboard.length > 0 &&
    (settings.showOverallResults ||
      (isHost && !settings.hostParticipates && !presentAtEnd));
  // Full board when finished without staged presentation.
  const showFinalLeaderboard =
    isFinished && leaderboard.length > 0 && !presentAtEnd;
  const showLeaderboardPresentation =
    isFinished && presentAtEnd && leaderboard.length > 0;
  const flipOrderKey = visibleLeaderboard.map((row) => row.user_id).join("|");
  const leaderboardListRef = useFlipList(flipOrderKey);

  const atTrackLimit =
    maxCuratedTracks != null && trackCount >= maxCuratedTracks;
  const atRoundLimit =
    maxCuratedTracks != null && currentRoundNumber >= maxCuratedTracks;
  const atMemberLimit =
    maxMembersProp != null && memberCount >= maxMembersProp;
  const limitErrorMessage =
    (startState?.error && isQuizPlanLimitError(startState.error)
      ? startState.error
      : null) ||
    (addState?.error && isQuizPlanLimitError(addState.error)
      ? addState.error
      : null);
  const showPlanLimitPrompt =
    isHost &&
    !isFinished &&
    !unlocked &&
    !isLive &&
    (atRoundLimit || atTrackLimit || atMemberLimit || Boolean(limitErrorMessage));

  const [guessYear, setGuessYear] = useState(
    myGuessYearProp != null ? String(myGuessYearProp) : "",
  );
  const [guessWasNumberOne, setGuessWasNumberOne] = useState<boolean | null>(
    myGuessWasNumberOneProp,
  );
  const [optimisticGuessYear, setOptimisticGuessYear] = useState<number | null>(
    null,
  );
  // Host list: patch from broadcast/postgres immediately (don't wait on snapshot alone).
  const [liveGuesses, setLiveGuesses] = useState(roundGuessesProp);
  /**
   * Keep the last revealed round on screen for RESULT_HOLD_MS so players can
   * read the answer — including briefly in parallel with the next live round.
   * After the hold (or when the quiz is already finished on load) it moves
   * into Previous rounds so the host can still exclude it.
   */
  const initiallyFinished =
    quizStatusProp === "finished" || quizStatusProp === "expired";
  const [pinnedResult, setPinnedResult] = useState<{
    round: RoundRow;
    guesses: GuessRow[];
    teamGroups: TeamRoundGroup[];
  } | null>(
    resultRoundProp && !activeRoundProp && !initiallyFinished
      ? {
          round: resultRoundProp,
          guesses: roundGuessesProp,
          teamGroups: resultTeamGroupsProp,
        }
      : null,
  );
  const pinStartedAtRef = useRef<number | null>(
    resultRoundProp && !activeRoundProp && !initiallyFinished
      ? Date.now()
      : null,
  );

  // Pin latest between-round results. A finished quiz keeps the last round
  // in Previous rounds instead of holding the results card forever.
  useEffect(() => {
    if (!resultRound || activeRound || isFinished) return;
    setPinnedResult((prev) => {
      if (prev?.round.id !== resultRound.id) {
        pinStartedAtRef.current = Date.now();
      }
      return {
        round: resultRound,
        guesses: roundGuesses,
        teamGroups: resultTeamGroups,
      };
    });
  }, [
    resultRound?.id,
    activeRound?.id,
    resultRound,
    activeRound,
    roundGuesses,
    resultTeamGroups,
    isFinished,
  ]);

  useEffect(() => {
    if (!pinnedResult) return;
    const started = pinStartedAtRef.current ?? Date.now();
    const remaining = Math.max(0, RESULT_HOLD_MS - (Date.now() - started));
    const timer = window.setTimeout(() => {
      setPinnedResult(null);
      pinStartedAtRef.current = null;
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [pinnedResult?.round.id]);

  const displayResultRound = pinnedResult?.round ?? null;
  const displayResultGuesses = pinnedResult?.guesses ?? [];
  const displayResultTeamGroups = pinnedResult?.teamGroups ?? [];
  const showResultCard = Boolean(displayResultRound) && Boolean(pinnedResult);

  // Hide the pinned result from Previous rounds while its card is still up.
  const historyRounds = pastRounds.filter(
    (round) => !showResultCard || round.id !== displayResultRound?.id,
  );
  const excludeConfirmRound = excludeConfirmRoundId
    ? historyRounds.find((round) => round.id === excludeConfirmRoundId) ?? null
    : null;
  const includeConfirmRound = includeConfirmRoundId
    ? historyRounds.find((round) => round.id === includeConfirmRoundId) ?? null
    : null;

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
    setDraftTrack({ title: "", artist: "", previewUrl: "", releaseYear: null });
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
    setGuessWasNumberOne(myGuessWasNumberOne);
    if (myGuessYear != null) setOptimisticGuessYear(null);
  }, [myGuessYear, myGuessWasNumberOne, activeRound?.id]);

  useEffect(() => {
    setOptimisticGuessYear(null);
  }, [activeRound?.id]);

  async function submitGuess(formData: FormData) {
    const year = Number(formData.get("guessedYear"));
    const chartRaw = String(formData.get("guessedWasNumberOne") ?? "").trim();
    const chartGuess =
      chartRaw === "true" ? true : chartRaw === "false" ? false : null;
    if (Number.isFinite(year)) {
      setOptimisticGuessYear(year);
      setLive((prev) => ({
        ...prev,
        myGuessYear: year,
        myGuessWasNumberOne: chartGuess,
      }));
    }
    setGuessBusy(true);
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setGuessBusy(false);
    }, 8000);
    try {
      const next = await submitGuessAction(null, formData);
      if (!settled) {
        setGuessState(next);
        if (next?.guess?.guessedYear != null) {
          setLive((prev) => ({
            ...prev,
            myGuessYear: next.guess!.guessedYear,
            myGuessWasNumberOne: next.guess!.guessedWasNumberOne ?? null,
          }));
          setGuessWasNumberOne(next.guess!.guessedWasNumberOne ?? null);
        }
      }
    } catch (error) {
      if (!settled) {
        setGuessState({
          error: error instanceof Error ? error.message : "Could not save guess.",
        });
      }
    } finally {
      settled = true;
      window.clearTimeout(timeout);
      setGuessBusy(false);
    }
  }

  useEffect(() => {
    setLiveGuesses(roundGuesses);
  }, [roundGuesses, activeRound?.id]);

  useEffect(() => {
    return subscribeQuizGuesses(quizId, (patch: QuizGuessLivePatch) => {
      if (!activeRound || patch.roundId !== activeRound.id) return;
      setLiveGuesses((prev) => {
        const rest = prev.filter((row) => row.user_id !== patch.userId);
        // Newest submission on top; never store the year for the host list.
        return [
          {
            user_id: patch.userId,
            display_name: patch.displayName ?? "Player",
            guessed_year: null,
            guessed_was_number_one: null,
            points_total: 0,
            submitted_at: new Date().toISOString(),
          },
          ...rest,
        ];
      });
    });
  }, [quizId, activeRound]);

  async function submitReveal(formData: FormData) {
    setRevealBusy(true);
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setRevealBusy(false);
    }, 8000);
    try {
      const next = await advanceLeaderboardRevealAction(null, formData);
      if (!settled) {
        setRevealState(next);
      }
    } catch (error) {
      if (!settled) {
        setRevealState({
          error: error instanceof Error ? error.message : "Could not reveal.",
        });
      }
    } finally {
      settled = true;
      window.clearTimeout(timeout);
      setRevealBusy(false);
    }
  }

  const chartComboEnabled = scoringCombinesChart(settings);
  const chartCountriesShort = chartCountriesShortLabel(settings.chartCountries);
  const scoreUnit = scoringUnitLabel(settings);

  // Keep the staged reveal near the top while the host presents.
  useEffect(() => {
    if (!showLeaderboardPresentation) return;
    scrollToSection("leaderboard-presentation");
  }, [showLeaderboardPresentation, leaderboardRevealStep]);

  // After any successful play action: notify peers + soft refresh (MyContest pattern).
  useEffect(() => {
    const syncId =
      addState?.syncId ??
      startState?.syncId ??
      guessState?.syncId ??
      closeState?.syncId ??
      finishState?.syncId ??
      revealState?.syncId ??
      null;
    if (!syncId || syncId === lastSyncIdRef.current) return;
    lastSyncIdRef.current = syncId;
    const guessOnly = guessState?.syncId === syncId && Boolean(guessState.guess);
    void broadcastQuizResync(
      quizId,
      joinCode,
      guessOnly && guessState.guess ? { guess: guessState.guess } : undefined,
    );
    // Play UI updates from the live snapshot. Skip RSC refresh on round
    // start/close/guess/reveal so we do not double-load getQuizPlayState.
    // Add-track and finish still refresh shell bits (rules track count / roster).
    if (addState?.syncId === syncId || finishState?.syncId === syncId) {
      router.refresh();
    }
  }, [
    addState,
    startState,
    guessState,
    closeState,
    finishState,
    revealState,
    quizId,
    joinCode,
    router,
  ]);

  const remainingCount = Math.max(0, trackCount - currentRoundNumber);
  const allTracksPlayed =
    !isLive && trackCount > 0 && remainingCount === 0 && !activeRound;
  const quizComplete = isFinished || allTracksPlayed;
  const canFinish = isHost && !isFinished && !activeRound;
  const waitingForHost = !isHost && !activeRound && !quizComplete && !isFinished;
  const inactivityPaused = isInactivityQuizInterrupt(
    autoInterrupted,
    autoEmptyStreak,
    settings.autoInterruptAfterEmptyRounds,
  );
  const inactivityRoundCount = Math.max(
    autoEmptyStreak,
    settings.autoInterruptAfterEmptyRounds,
  );
  const playControlsActive = isHost && !isFinished;
  const presentationActive =
    isHost && showLeaderboardPresentation && !presentationComplete;
  const hostControlResetKey = presentationActive
    ? "presentation"
    : playControlsActive
      ? "play"
      : "done";
  /** Client (and host) current end-game stage — not live rounds. */
  const presentationStageActive =
    showLeaderboardPresentation && !presentationComplete;
  const finishedStageActive =
    !isHost && isFinished && !presentationStageActive;

  return (
    <div className="space-y-8">
      {settings.teamsEnabled ? (
        <QuizTeamsPanel
          quizId={quizId}
          joinCode={joinCode}
          isHost={isHost}
          currentUserId={currentUserId ?? ""}
          hostParticipates={settings.hostParticipates}
          locked={teamsLocked}
          teams={teams}
          roster={roster}
          onTeamsChange={(next) =>
            setLive((prev) => ({ ...prev, teams: next }))
          }
        />
      ) : null}

      {isHost && isLastfmLive ? (
        <CollapsibleCard
          sectionId={`quiz-${quizId}-live-spotify`}
          persist={false}
          resetKey={hostControlResetKey}
          defaultOpen={playControlsActive}
          className={cn(playControlsActive && ACTIVE_PANEL_CARD_CLASS)}
          title="Live Spotify (Last.fm)"
          description={
            isFinished
              ? "Playback controls are off after the quiz ended."
              : undefined
          }
          contentClassName="space-y-4"
        >
          <AutoLastfmHostControls
            quizId={quizId}
            joinCode={joinCode}
            lastfmUsername={settings.lastfmUsername}
            disabled={isFinished}
            autoInterrupted={autoInterrupted}
            autoEmptyStreak={autoEmptyStreak}
            quizStarted={quizStarted}
            emptyStreakThreshold={settings.autoInterruptAfterEmptyRounds}
            planId={planId}
            isAnonymous={isAnonymous}
            unlocked={unlocked}
            roundLimit={maxCuratedTracks}
            currentRoundNumber={currentRoundNumber}
            hasActiveRound={Boolean(activeRound)}
            canFinish={!isFinished}
            finishAction={finishAction}
            finishPending={finishPending}
            finishError={finishState?.error ?? null}
            liveOpenMode={liveOpenModeProp}
            liveDeferredTrackKey={liveDeferredTrackKeyProp}
            officialStartBlockedReason={teamsBlockOfficialStart}
            embedded
          />
          {isHost && atMemberLimit && !unlocked && !isFinished ? (
            <QuizPlanLimitPrompt
              quizId={quizId}
              joinCode={joinCode}
              kind="participants"
              cap={maxMembersProp}
              planId={planId}
              isAnonymous={isAnonymous}
              unlocked={unlocked}
            />
          ) : null}
        </CollapsibleCard>
      ) : null}

      {isHost && isAutoSpotify ? (
        <CollapsibleCard
          sectionId={`quiz-${quizId}-auto-spotify`}
          persist={false}
          resetKey={hostControlResetKey}
          defaultOpen={playControlsActive}
          className={cn(playControlsActive && ACTIVE_PANEL_CARD_CLASS)}
          title="Auto Spotify"
          description={
            isFinished
              ? "Playback controls are off after the quiz ended."
              : undefined
          }
          contentClassName="space-y-4"
        >
          <AutoSpotifyHostControls
            quizId={quizId}
            joinCode={joinCode}
            disabled={isFinished}
            autoInterrupted={autoInterrupted}
            autoEmptyStreak={autoEmptyStreak}
            quizStarted={quizStarted}
            emptyStreakThreshold={settings.autoInterruptAfterEmptyRounds}
            planId={planId}
            isAnonymous={isAnonymous}
            unlocked={unlocked}
            roundLimit={maxCuratedTracks}
            currentRoundNumber={currentRoundNumber}
            hasActiveRound={Boolean(activeRound)}
            canFinish={!isFinished}
            finishAction={finishAction}
            finishPending={finishPending}
            finishError={finishState?.error ?? null}
            embedded
            officialStartBlockedReason={teamsBlockOfficialStart}
          />
          {isHost && atMemberLimit && !unlocked && !isFinished ? (
            <QuizPlanLimitPrompt
              quizId={quizId}
              joinCode={joinCode}
              kind="participants"
              cap={maxMembersProp}
              planId={planId}
              isAnonymous={isAnonymous}
              unlocked={unlocked}
            />
          ) : null}
        </CollapsibleCard>
      ) : null}

      {isHost && !isLive ? (
        <CollapsibleCard
          sectionId={`quiz-${quizId}-host-controls`}
          persist={false}
          resetKey={hostControlResetKey}
          defaultOpen={playControlsActive}
          className={cn(playControlsActive && ACTIVE_PANEL_CARD_CLASS)}
          title="Host controls"
          description={
            <>
              Playlist from create · {trackCount}
              {maxCuratedTracks != null ? ` / ${maxCuratedTracks}` : ""} track
              {trackCount === 1 ? "" : "s"}
              {trackCount > 0
                ? ` · ${remainingCount} left to play`
                : " — add songs before starting"}
              {memberCount > 0
                ? ` · ${memberCount} player${memberCount === 1 ? "" : "s"}`
                : ""}
            </>
          }
          contentClassName="space-y-4"
        >

          {tracks.length > 0 ? (
            <ol className="max-h-48 list-decimal space-y-1 overflow-y-auto pl-5 text-sm">
              {tracks.map((track, index) => {
                const played = index < currentRoundNumber;
                const isNext = !activeRound && index === currentRoundNumber;
                const spotify = spotifyOpenForHostTrack({
                  spotifyTrackId: track.spotify_track_id,
                  trackName: track.track_name,
                  artistName: track.artist_name,
                });
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
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{track.track_name}</span>
                        {track.artist_name ? ` — ${track.artist_name}` : ""}
                        {isNext ? (
                          <span className="ml-2 text-xs text-primary">next</span>
                        ) : null}
                      </p>
                      <span
                        className={
                          track.has_release_year
                            ? "shrink-0 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-xs font-medium text-emerald-800"
                            : "shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-800"
                        }
                        title={
                          track.has_release_year
                            ? "Release year found — answer stays hidden until you close the round"
                            : "Release year missing — scoring needs a year; try re-adding the song"
                        }
                      >
                        {track.has_release_year ? "Year found" : "Year missing"}
                      </span>
                      {spotify ? (
                        <SpotifyTrackLink
                          href={spotify.href}
                          uri={spotify.uri}
                          openedKey={`${quizId}:${track.id}`}
                          preferApiPlay
                          className="shrink-0"
                        />
                      ) : null}
                    </div>
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
                  trackCount === 0 ||
                  allTracksPlayed ||
                  Boolean(teamsBlockOfficialStart)
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
                      : trackCount === 0
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
                  variant={allTracksPlayed ? "default" : "outline"}
                  className={
                    allTracksPlayed
                      ? undefined
                      : "text-destructive hover:text-destructive"
                  }
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
          {teamsBlockOfficialStart ? (
            <p className="text-sm text-amber-800 dark:text-amber-400">
              {teamsBlockOfficialStart}
            </p>
          ) : null}
          {startState?.error && !isQuizPlanLimitError(startState.error) ? (
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

          {showPlanLimitPrompt ? (
            <QuizPlanLimitPrompt
              quizId={quizId}
              joinCode={joinCode}
              message={limitErrorMessage}
              kind={
                atMemberLimit
                  ? "participants"
                  : atRoundLimit || atTrackLimit
                    ? "songs"
                    : undefined
              }
              cap={atMemberLimit ? maxMembersProp : maxCuratedTracks}
              planId={planId}
              isAnonymous={isAnonymous}
              unlocked={unlocked}
            />
          ) : null}

          {addState?.error && !showAddTrack && !isQuizPlanLimitError(addState.error) ? (
            <p className="text-sm text-destructive">{addState.error}</p>
          ) : null}

          {showAddTrack && !isFinished && !atTrackLimit ? (
            <form action={addAction} className="space-y-3 rounded-xl border border-border/60 p-4">
              <input type="hidden" name="quizId" value={quizId} />
              <input type="hidden" name="joinCode" value={joinCode} />
              <input type="hidden" name="trackName" value={draftTrack.title} />
              <input type="hidden" name="artistName" value={draftTrack.artist} />
              <input type="hidden" name="previewUrl" value={draftTrack.previewUrl} />
              <input
                type="hidden"
                name="releaseYear"
                value={draftTrack.releaseYear ?? ""}
              />
              <SongPickFields
                compact
                value={draftTrack}
                idPrefix="host-add-track"
                searchLabel="Search song to add"
                onChange={(value) =>
                  setDraftTrack({
                    title: value.title,
                    artist: value.artist,
                    previewUrl: value.previewUrl,
                    releaseYear: value.releaseYear ?? null,
                  })
                }
              />
              {draftTrack.title ? (
                <p className="text-xs text-muted-foreground">
                  Release year is resolved on save and stays hidden until you close the
                  round.
                </p>
              ) : null}
              <Button
                type="submit"
                disabled={addPending || !draftTrack.title.trim() || !draftTrack.artist.trim()}
              >
                {addPending ? "Adding…" : "Add to playlist"}
              </Button>
              {addState?.error && !isQuizPlanLimitError(addState.error) ? (
                <p className="text-sm text-destructive" role="alert">
                  {addState.error}
                </p>
              ) : null}
              {addState?.error && isQuizPlanLimitError(addState.error) ? (
                <QuizPlanLimitPrompt
                  quizId={quizId}
                  joinCode={joinCode}
                  message={addState.error}
                  planId={planId}
                  isAnonymous={isAnonymous}
                  unlocked={unlocked}
                />
              ) : null}
            </form>
          ) : null}
        </CollapsibleCard>
      ) : null}

      <FadeMount show={waitingForHost}>
        <section
          className={cn(
            "space-y-4 rounded-2xl p-6",
            inactivityPaused ? "bg-amber-500/5" : "bg-card",
            ACTIVE_PANEL_CARD_CLASS,
          )}
        >
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Waiting for the host</h2>
            <p
              className={cn(
                "text-sm",
                inactivityPaused ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {inactivityPaused
                ? `The quiz was paused because no one guessed for ${inactivityRoundCount} song${inactivityRoundCount === 1 ? "" : "s"} in a row. The host will resume when everyone is ready.`
                : isLive
                  ? !quizStarted
                    ? "Pre-rounds are open for practice. The host will start the quiz when everyone is ready."
                    : currentRoundNumber > 0
                      ? "Round results are on the board. The next song in Spotify will open a new round."
                      : isLastfmLive
                        ? "Live mode is on — this page updates when Spotify scrobbles the next song to Last.fm."
                        : "Auto Spotify is on — this page updates when the host starts playing a song."
                  : currentRoundNumber > 0
                    ? `Round ${currentRoundNumber} is done. Hang tight — the host will start the next round.`
                    : "The quiz is live. This page updates automatically when the host starts a round."}
            </p>
          </div>
        </section>
      </FadeMount>

      <FadeMount show={isFinished || showLeaderboardPresentation}>
        <div className="space-y-8">
          {isFinished ? (
            <section
              className={cn(
                "space-y-2 rounded-2xl bg-card p-6",
                finishedStageActive
                  ? ACTIVE_PANEL_CARD_CLASS
                  : "border border-border/60",
              )}
            >
              <h2 className="text-lg font-semibold">Quiz finished</h2>
              <p className="text-sm text-muted-foreground">
                {presentAtEnd
                  ? presentationComplete
                    ? "This quiz is closed. Final standings are on the leaderboard below."
                    : "This quiz is closed. The host will present the final leaderboard."
                  : "This quiz is closed. Final standings are on the leaderboard below."}
              </p>
            </section>
          ) : null}

          {showLeaderboardPresentation ? (
            <CollapsibleCard
              id="leaderboard-presentation"
              sectionId={`quiz-${quizId}-leaderboard-presentation`}
              persist={!isHost}
              resetKey={isHost ? hostControlResetKey : undefined}
              defaultOpen={isHost ? presentationActive || isFinished : true}
              className={cn(
                presentationStageActive && ACTIVE_PANEL_CARD_CLASS,
                "scroll-mt-20",
              )}
              title="Leaderboard presentation"
              description={
                <>
                  {scoringLowWins(settings) ? "Lowest score wins. " : null}
                  {presentationComplete ? (
                    <span className="font-medium text-destructive">complete</span>
                  ) : leaderboardRevealStep > 0 ? (
                    <span className="font-medium text-amber-700 dark:text-amber-400">
                      revealing…
                    </span>
                  ) : (
                    <span>waiting to start</span>
                  )}
                  {settings.overallReveal === "last_to_first" &&
                  leaderboard.length > 0 ? (
                    <span>
                      {" "}
                      · place reveal{" "}
                      {Math.min(leaderboardRevealStep, leaderboard.length)} of{" "}
                      {leaderboard.length}
                    </span>
                  ) : null}
                </>
              }
              contentClassName="space-y-4"
            >
              {isHost && !presentationComplete ? (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitReveal(new FormData(event.currentTarget));
                  }}
                >
                  <input type="hidden" name="quizId" value={quizId} />
                  <input type="hidden" name="joinCode" value={joinCode} />
                  <Button type="submit" disabled={revealBusy}>
                    {revealBusy
                      ? "Updating…"
                      : settings.overallReveal === "immediate"
                        ? "Present full leaderboard"
                        : leaderboardRevealStep === 0
                          ? "Reveal last place"
                          : "Reveal next place"}
                  </Button>
                  {revealState?.error ? (
                    <p className="w-full text-sm text-destructive">
                      {revealState.error}
                    </p>
                  ) : null}
                </form>
              ) : null}

              {visibleLeaderboard.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {isHost
                    ? "Press the button above to start presenting the leaderboard."
                    : "Waiting for the host to reveal the next results step…"}
                </p>
              ) : (
                <ol ref={leaderboardListRef} className="space-y-2">
                  {visibleLeaderboard.map((row) => (
                    <li
                      key={row.user_id}
                      data-flip-id={row.user_id}
                      className={cn(
                        "flex items-center justify-between rounded-lg border px-4 py-3 text-sm",
                        "transition-[background-color,border-color,box-shadow] duration-700 ease-out",
                        podiumRowClass(row.rank),
                      )}
                    >
                      <span className="min-w-0">
                        <span
                          className={cn(
                            podiumRankClass(row.rank),
                            "transition-[color,font-size] duration-700 ease-out",
                          )}
                        >
                          #{row.rank}
                        </span>{" "}
                        {row.display_name}
                        {rowIncludesUser(row, currentUserId) ? (
                          <span className="text-muted-foreground"> (You)</span>
                        ) : null}
                        {rowIncludesUser(row, hostUserId) ? (
                          <span className="text-muted-foreground"> (Host)</span>
                        ) : null}
                        {leaderboardMemberLine(row) ? (
                          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                            {leaderboardMemberLine(row)}
                          </span>
                        ) : null}
                      </span>
                      <span className="font-medium tabular-nums">
                        {formatTeamScore(row.total_points)} {scoreUnit}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </CollapsibleCard>
          ) : null}
        </div>
      </FadeMount>

      <FadeMount show={allTracksPlayed && !isFinished && !showLeaderboardPresentation}>
        <section
          className={cn(
            "space-y-2 rounded-2xl bg-card p-6",
            !isHost
              ? ACTIVE_PANEL_CARD_CLASS
              : "border border-border/60",
          )}
        >
          <h2 className="text-lg font-semibold">All tracks played</h2>
          <p className="text-sm text-muted-foreground">
            {isHost
              ? "Add another song to continue, or finish the quiz to lock results."
              : "Waiting for the host to finish the quiz or start another round."}
          </p>
        </section>
      </FadeMount>

      <FadeMount show={Boolean(activeRound)}>
        {activeRound ? (
        <section className="space-y-4 rounded-2xl border border-primary/30 bg-primary/5 p-6">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">
              {activeRound.is_pre_round || (isLive && !quizStarted)
                ? "Pre-round"
                : "Live round"}
            </p>
            <h2 className="text-lg font-semibold">
              {activeRound.round_label ||
                formatRoundLabel({
                  isPreRound:
                    Boolean(activeRound.is_pre_round) ||
                    (isLive && !quizStarted),
                  displayRoundNumber:
                    activeRound.display_round_number ||
                    activeRound.round_number,
                })}{" "}
              · Guess the release year
            </h2>
          </div>
          {settings.showTitleArtist ? (
            <p className="text-sm">
              <span className="font-medium text-foreground">
                {activeRound.track_name}
              </span>
              {activeRound.artist_name ? ` — ${activeRound.artist_name}` : ""}
            </p>
          ) : null}

          <form action={submitGuess} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="roundId" value={activeRound.id} />
            <input type="hidden" name="joinCode" value={joinCode} />
            <input
              type="hidden"
              name="guessedWasNumberOne"
              value={
                guessWasNumberOne == null
                  ? ""
                  : guessWasNumberOne
                    ? "true"
                    : "false"
              }
            />
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col items-center gap-2">
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
              <Button
                type="submit"
                disabled={guessBusy}
                variant={
                  (myGuessYear ?? optimisticGuessYear) != null
                    ? "outline"
                    : "default"
                }
              >
                {guessBusy
                  ? "Saving…"
                  : (myGuessYear ?? optimisticGuessYear) != null
                    ? "Update guess"
                    : "Submit guess"}
              </Button>
            </div>
            {chartComboEnabled ? (
              <div className="space-y-2">
                <Label>
                  Was this a chart #1
                  {chartCountriesShort ? ` (${chartCountriesShort})` : ""}?
                </Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={guessWasNumberOne === true ? "default" : "outline"}
                    onClick={() =>
                      setGuessWasNumberOne((prev) => (prev === true ? null : true))
                    }
                  >
                    Yes
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={guessWasNumberOne === false ? "default" : "outline"}
                    onClick={() =>
                      setGuessWasNumberOne((prev) =>
                        prev === false ? null : false,
                      )
                    }
                  >
                    No
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Optional — leave blank if unsure.
                </p>
              </div>
            ) : null}
            {guessState?.error ? (
              <p className="w-full text-sm text-destructive">{guessState.error}</p>
            ) : null}
            <p className="flex min-h-11 w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-background/70 px-3 py-2 text-foreground ring-1 ring-primary/25">
              {(myGuessYear ?? optimisticGuessYear) != null &&
              !guessState?.error ? (
                <CheckIcon
                  className="size-4 shrink-0 text-primary"
                  weight="bold"
                  aria-hidden
                />
              ) : (
                <span className="size-4 shrink-0" aria-hidden />
              )}
              <span className="text-sm font-medium">Your current guess</span>
              <span
                className={cn(
                  "text-xl font-semibold tabular-nums tracking-tight",
                  (myGuessYear ?? optimisticGuessYear) == null &&
                    "text-muted-foreground",
                )}
              >
                {myGuessYear ?? optimisticGuessYear ?? "—"}
              </span>
              {chartComboEnabled ? (
                <span className="text-sm text-muted-foreground">
                  {(myGuessYear ?? optimisticGuessYear) == null
                    ? "· #1 —"
                    : myGuessWasNumberOne == null
                      ? "· #1 skipped"
                      : myGuessWasNumberOne
                        ? "· #1 yes"
                        : "· #1 no"}
                </span>
              ) : null}
            </p>
            {!isHost ? (
              <p className="w-full text-sm text-muted-foreground">
                {settings.showTitleArtist
                  ? "Listen, then enter the release year. Updates appear live for everyone."
                  : "Listen to the track the host is playing, then enter the release year. Updates appear live for everyone."}
              </p>
            ) : null}
          </form>

          {isHost && !isLive ? (
            <div className="space-y-3 border-t border-border/60 pt-4">
              <form action={closeAction}>
                <input type="hidden" name="roundId" value={activeRound.id} />
                <input type="hidden" name="joinCode" value={joinCode} />
                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={closePending || skipPending}
                >
                  {closePending ? "Closing…" : "Close round & reveal"}
                </Button>
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Score this round and show the correct year to everyone.
                </p>
              </form>

              <div className="rounded-xl border border-border/50 bg-muted/25 p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Other actions
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full text-destructive hover:text-destructive"
                  disabled={skipPending || closePending}
                  onClick={() => setSkipConfirmOpen(true)}
                >
                  Skip this song
                </Button>
              </div>

              {closeState?.error ? (
                <p className="text-sm text-destructive">{closeState.error}</p>
              ) : null}
              {skipState?.error ? (
                <p className="text-sm text-destructive">{skipState.error}</p>
              ) : null}

              <Dialog open={skipConfirmOpen} onOpenChange={setSkipConfirmOpen}>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Skip this song?</DialogTitle>
                    <DialogDescription>
                      All guesses for this round are discarded. The round will not
                      be scored and the same round number continues with the next
                      song.
                    </DialogDescription>
                  </DialogHeader>
                  <form
                    action={skipAction}
                    onSubmit={() => setSkipConfirmOpen(false)}
                  >
                    <input type="hidden" name="roundId" value={activeRound.id} />
                    <input type="hidden" name="joinCode" value={joinCode} />
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={skipPending}
                        onClick={() => setSkipConfirmOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" variant="destructive" disabled={skipPending}>
                        {skipPending ? "Skipping…" : "Yes, skip this song"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
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
                      <span>
                        {g.display_name}
                        {g.user_id === currentUserId ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (You)
                          </span>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground">Guessed</span>
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
      </FadeMount>

      <FadeMount show={Boolean(showResultCard && displayResultRound)}>
        {displayResultRound ? (
        <section className="space-y-4 rounded-2xl border border-border/60 bg-card p-6">
          <h2 className="text-lg font-semibold">
            {displayResultRound.round_label ||
              formatRoundLabel({
                isPreRound:
                  Boolean(displayResultRound.is_pre_round) ||
                  (isLive && !quizStarted),
                displayRoundNumber:
                  displayResultRound.display_round_number ||
                  displayResultRound.round_number,
              })}{" "}
            results
            {activeRound ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                (previous)
              </span>
            ) : null}
          </h2>
          <p className="text-sm">
            <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-2">
              <span>
                <span className="font-medium">{displayResultRound.track_name}</span>
                {displayResultRound.artist_name
                  ? ` — ${displayResultRound.artist_name}`
                  : ""}
              </span>
              {isHost
                ? (() => {
                    const spotify = spotifyOpenForHostTrack({
                      spotifyTrackId: displayResultRound.spotify_track_id,
                      trackName: displayResultRound.track_name,
                      artistName: displayResultRound.artist_name,
                    });
                    return spotify ? (
                      <SpotifyTrackLink
                        href={spotify.href}
                        uri={spotify.uri}
                        openedKey={`${quizId}:result:${displayResultRound.id}`}
                        preferApiPlay
                      />
                    ) : null;
                  })()
                : null}
            </span>
          </p>
          <RoundCorrectYear
            round={displayResultRound}
            show={isHost || settings.showCorrectAnswer}
            showChartOne={chartComboEnabled}
            chartCountries={settings.chartCountries}
          />
          {settings.teamsEnabled ? (
            <TeamRoundGuessesList
              groups={displayResultTeamGroups}
              showChartGuess={chartComboEnabled}
              wasNumberOne={
                chartComboEnabled ? displayResultRound.chart_was_number_one : null
              }
              currentUserId={currentUserId}
              scoreUnit={scoreUnit}
              emptyLabel={
                !isHost && !settings.showOthersInPastResults
                  ? "Only your team is shown for this round."
                  : "No team results this round."
              }
            />
          ) : (
            <RoundGuessesList
              guesses={displayResultGuesses}
              showChartGuess={chartComboEnabled}
              wasNumberOne={
                chartComboEnabled ? displayResultRound.chart_was_number_one : null
              }
              currentUserId={currentUserId}
              scoreUnit={scoreUnit}
            />
          )}
        </section>
        ) : null}
      </FadeMount>

      {showRunningLeaderboard || showFinalLeaderboard ? (
        <CollapsibleCard
          sectionId={`quiz-${quizId}-leaderboard`}
          defaultOpen
          title="Leaderboard"
          description={
            scoringLowWins(settings) ? "Lowest score wins." : undefined
          }
          contentClassName="pt-0"
        >
          <ul className="divide-y divide-border/60 text-sm">
            {leaderboard.map((row, index) => (
              <li
                key={row.user_id}
                className="flex min-w-0 items-center gap-2 py-2"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">
                    #{index + 1} {row.display_name}
                  </span>
                  {rowIncludesUser(row, currentUserId) ? (
                    <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                  ) : null}
                  {rowIncludesUser(row, hostUserId) ? (
                    <span className="ml-2 text-xs text-muted-foreground">(host)</span>
                  ) : null}
                  {leaderboardMemberLine(row) ? (
                    <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                      {leaderboardMemberLine(row)}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 font-medium tabular-nums">
                  {formatTeamScore(row.total_points)} {scoreUnit}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {scoringLowWins(settings)
                      ? `(${formatTeamScore(row.last_round_points ?? 0)})`
                      : `(+${formatTeamScore(row.last_round_points ?? 0)})`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </CollapsibleCard>
      ) : null}

      {historyRounds.length > 0 ? (
        <CollapsibleCard
          sectionId={`quiz-${quizId}-previous-rounds`}
          defaultOpen={false}
          title={
            <>
              Previous rounds{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({historyRounds.length})
              </span>
            </>
          }
          contentClassName="pt-0"
        >
          <ul className="divide-y divide-border/60 text-sm">
            {historyRounds.map((round) => {
              const expanded =
                settings.showResultDetails && expandedPastRoundId === round.id;
              const canExpand =
                settings.showResultDetails && round.status !== "skipped";
              const outcome = roundOutcomeLabel(round.status);
              const isExcluded = round.status === "excluded";
              const isSkipped = round.status === "skipped";
              return (
                <li key={round.id} className="space-y-2 py-2">
                  <div className="flex min-w-0 items-start gap-2">
                    <button
                      type="button"
                      className={cn(
                        "flex min-w-0 flex-1 items-start gap-2 text-left",
                        canExpand && "cursor-pointer",
                      )}
                      disabled={!canExpand}
                      aria-expanded={canExpand ? expanded : undefined}
                      onClick={() => {
                        if (!canExpand) return;
                        setExpandedPastRoundId((id) =>
                          id === round.id ? null : round.id,
                        );
                      }}
                    >
                      <p
                        className={cn(
                          "min-w-0 flex-1 break-words leading-snug",
                          isExcluded && "text-muted-foreground line-through",
                        )}
                      >
                        <span className="text-muted-foreground tabular-nums">
                          {isSkipped
                            ? "Skipped"
                            : round.round_label ||
                              formatRoundLabel({
                                isPreRound:
                                  Boolean(round.is_pre_round) ||
                                  (isLive && !quizStarted),
                                displayRoundNumber:
                                  round.display_round_number || round.round_number,
                              })}
                        </span>
                        {outcome && !isSkipped ? (
                          <span className="ml-2 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                            {outcome}
                          </span>
                        ) : null}
                        {" · "}
                        <span className="font-medium">{round.track_name}</span>
                        {round.artist_name ? ` — ${round.artist_name}` : ""}
                      </p>
                      <p
                        className={cn(
                          "flex shrink-0 items-center gap-1 font-medium tabular-nums",
                          isExcluded
                            ? "text-muted-foreground line-through"
                            : isSkipped
                              ? "text-muted-foreground"
                              : "text-emerald-700",
                        )}
                      >
                        {isSkipped
                          ? "—"
                          : settings.showResultDetails
                            ? isHost || settings.showCorrectAnswer
                              ? (round.correct_release_year ?? "—")
                              : "—"
                            : `${round.my_points ?? 0} ${scoreUnit}`}
                        {canExpand ? (
                          <CaretDownIcon
                            className={cn(
                              "size-4 text-muted-foreground transition-transform",
                              expanded && "rotate-180",
                            )}
                            aria-hidden
                          />
                        ) : null}
                      </p>
                    </button>
                  </div>
                  {expanded ? (
                    <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <RoundCorrectYear
                          round={round}
                          show={isHost || settings.showCorrectAnswer}
                          showChartOne={chartComboEnabled}
                          chartCountries={settings.chartCountries}
                        />
                        {isHost && round.status === "revealed" ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 shrink-0 px-2 text-xs font-normal text-muted-foreground/50 hover:bg-destructive/5 hover:text-destructive/75"
                            disabled={excludePending || includePending}
                            onClick={() => setExcludeConfirmRoundId(round.id)}
                          >
                            Exclude
                          </Button>
                        ) : null}
                        {isHost && round.status === "excluded" ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 shrink-0 px-2 text-xs font-normal text-muted-foreground/50 hover:bg-muted/50 hover:text-muted-foreground"
                            disabled={excludePending || includePending}
                            onClick={() => setIncludeConfirmRoundId(round.id)}
                          >
                            Include
                          </Button>
                        ) : null}
                      </div>
                      {settings.teamsEnabled ? (
                        <TeamRoundGuessesList
                          groups={round.teamGroups ?? []}
                          showChartGuess={chartComboEnabled}
                          wasNumberOne={
                            chartComboEnabled ? round.chart_was_number_one : null
                          }
                          currentUserId={currentUserId}
                          scoreUnit={scoreUnit}
                          emptyLabel={
                            !isHost && !settings.showOthersInPastResults
                              ? "Only your team is shown for this round."
                              : "No team results this round."
                          }
                        />
                      ) : (
                        <RoundGuessesList
                          guesses={round.guesses}
                          showChartGuess={chartComboEnabled}
                          wasNumberOne={
                            chartComboEnabled ? round.chart_was_number_one : null
                          }
                          currentUserId={currentUserId}
                          scoreUnit={scoreUnit}
                          emptyLabel={
                            !isHost && !settings.showOthersInPastResults
                              ? "Only your guess is shown for this round."
                              : "No guesses this round."
                          }
                        />
                      )}
                      {round.preview_url ? (
                        <SongPreviewPlayer previewUrl={round.preview_url} />
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {excludeState?.error || includeState?.error ? (
            <p className="pt-2 text-sm text-destructive" role="alert">
              {excludeState?.error ?? includeState?.error}
            </p>
          ) : null}

          <Dialog
            open={excludeConfirmRoundId != null}
            onOpenChange={(open) => {
              if (!open) setExcludeConfirmRoundId(null);
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Exclude this round from scoring?</DialogTitle>
                <DialogDescription>
                  {excludeConfirmRound ? (
                    <>
                      <span className="font-medium text-foreground">
                        {excludeConfirmRound.track_name}
                        {excludeConfirmRound.artist_name
                          ? ` — ${excludeConfirmRound.artist_name}`
                          : ""}
                      </span>{" "}
                      will stay visible in the history, but its points are removed
                      from the leaderboard for everyone. You can include it again
                      later.
                    </>
                  ) : (
                    "This round will be removed from the leaderboard for everyone."
                  )}
                </DialogDescription>
              </DialogHeader>
              {excludeConfirmRound ? (
                <form
                  action={excludeAction}
                  onSubmit={() => setExcludeConfirmRoundId(null)}
                >
                  <input type="hidden" name="roundId" value={excludeConfirmRound.id} />
                  <input type="hidden" name="joinCode" value={joinCode} />
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={excludePending}
                      onClick={() => setExcludeConfirmRoundId(null)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" variant="destructive" disabled={excludePending}>
                      {excludePending ? "Excluding…" : "Yes, exclude round"}
                    </Button>
                  </DialogFooter>
                </form>
              ) : null}
            </DialogContent>
          </Dialog>

          <Dialog
            open={includeConfirmRoundId != null}
            onOpenChange={(open) => {
              if (!open) setIncludeConfirmRoundId(null);
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Include this round in scoring again?</DialogTitle>
                <DialogDescription>
                  {includeConfirmRound ? (
                    <>
                      <span className="font-medium text-foreground">
                        {includeConfirmRound.track_name}
                        {includeConfirmRound.artist_name
                          ? ` — ${includeConfirmRound.artist_name}`
                          : ""}
                      </span>{" "}
                      will count toward the leaderboard again for everyone.
                    </>
                  ) : (
                    "This round will count toward the leaderboard again for everyone."
                  )}
                </DialogDescription>
              </DialogHeader>
              {includeConfirmRound ? (
                <form
                  action={includeAction}
                  onSubmit={() => setIncludeConfirmRoundId(null)}
                >
                  <input type="hidden" name="roundId" value={includeConfirmRound.id} />
                  <input type="hidden" name="joinCode" value={joinCode} />
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={includePending}
                      onClick={() => setIncludeConfirmRoundId(null)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={includePending}>
                      {includePending ? "Including…" : "Yes, include round"}
                    </Button>
                  </DialogFooter>
                </form>
              ) : null}
            </DialogContent>
          </Dialog>
        </CollapsibleCard>
      ) : null}
    </div>
  );
}
