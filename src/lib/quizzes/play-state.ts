import { createAdminClient } from "@/lib/supabase/admin";
import { getOptionalUser } from "@/lib/supabase/auth";
import { DEFAULT_MAX_CURATED_TRACKS } from "@/lib/quiz-plans";
import {
  lateJoinAssignedPoints,
  lateJoinAssignmentFromBreakdown,
  lateJoinBreakdownPayload,
  isLateJoinBreakdown,
  readQuizSettingsRuntime,
  resolveQuizSettings,
  type LateJoinAssignment,
} from "@/lib/quiz-scoring";
import type { BeatageQuizSettings } from "@/lib/quiz-settings";
import {
  DEFAULT_QUIZ_SETTINGS,
  formatRoundLabel,
  isPreRoundNumber,
  roundConsumesPlanCap,
  scoringLowWins,
} from "@/lib/quiz-settings";
import {
  buildTeamLeaderboard,
  buildTeamRoundGroups,
  isScoringQuizMember,
  quizTeamsAreLocked,
  type QuizRosterMember,
  type QuizTeamInfo,
  type TeamRoundGroup,
} from "@/lib/quiz-teams";
import { loadQuizTeams } from "@/lib/quizzes/teams";
import {
  backfillMissingReleaseYearsForQuiz,
  getQuizCuratedTrackLimit,
} from "@/lib/quiz-tracks";
import { resolveActiveRound } from "@/lib/quiz-active-round";

export type CuratedTrackRow = {
  id: string;
  sort_order: number;
  track_name: string;
  artist_name: string | null;
  /** Never exposed before reveal — use has_release_year for host status. */
  release_year: number | null;
  original_release_year: number | null;
  /** True when a release year is stored (host playlist status only). */
  has_release_year: boolean;
  album_art_url: string | null;
  spotify_track_id: string | null;
};

export type RoundRow = {
  id: string;
  round_number: number;
  /** 1-based index within pre-rounds or within official rounds. */
  display_round_number: number;
  /** Warm-up round before the host starts the official quiz. */
  is_pre_round: boolean;
  /** Ready-to-render label, e.g. "Pre Round 1" / "Round 2". */
  round_label: string;
  status: string;
  track_name: string | null;
  artist_name: string | null;
  /** Only populated after the round is revealed. */
  correct_release_year: number | null;
  original_release_year: number | null;
  /** True when the round has a stored answer year (safe to show before reveal). */
  has_correct_year: boolean;
  album_art_url: string | null;
  preview_url: string | null;
  spotify_track_id: string | null;
  /** Set after reveal when Chart #1 scoring is on. Null while the round is live. */
  chart_was_number_one: boolean | null;
};

export type GuessRow = {
  user_id: string;
  display_name: string;
  /**
   * Hidden while the round is active (host must not see answers early).
   * Populated after reveal for the results list.
   */
  guessed_year: number | null;
  /** Chart #1 yes/no guess — null when not answered. Hidden while round is active. */
  guessed_was_number_one: boolean | null;
  points_total: number;
  /** ISO timestamp — newest first in host / results lists. */
  submitted_at: string;
};

export type LeaderboardMember = {
  user_id: string;
  display_name: string;
};

export type LeaderboardRow = {
  user_id: string;
  display_name: string;
  total_points: number;
  /** Points earned in the most recent revealed round (0 if none). */
  last_round_points: number;
  /** Team mode: row is a team; user_id is the team id. */
  kind?: "player" | "team";
  members?: LeaderboardMember[];
};

export type PastRoundRow = RoundRow & {
  /** Caller's points for this round (null if they did not guess). */
  my_points: number | null;
  /** Full guess list when showResultDetails is on. */
  guesses: GuessRow[];
  /** Team mode: grouped results with visibility already applied. */
  teamGroups: TeamRoundGroup[];
  /** Viewer joined after this round; score is the field average + 10%. */
  lateJoinAssigned?: LateJoinAssignment | null;
};

/** Slim round columns — album art stays off the list payload. */
const ROUND_CORE_COLUMNS =
  "id, round_number, status, track_name, artist_name, correct_release_year, original_release_year, spotify_track_id, chart_was_number_one, preview_url";

function assignDisplayRoundNumbers(
  rounds: Array<{ round_number: number; status: string }>,
  runtime: { quizStarted?: boolean; preRoundCutoff?: number },
): Array<{
  round_number: number;
  display_round_number: number;
  is_pre_round: boolean;
}> {
  const byNumber = [...rounds].sort((a, b) => a.round_number - b.round_number);
  let preCount = 0;
  let officialCount = 0;
  const displayByNumber = new Map<
    number,
    { display: number; isPre: boolean }
  >();
  for (const round of byNumber) {
    // Skipped rounds do not consume an official/pre display slot.
    if (round.status === "skipped") continue;
    const isPre = isPreRoundNumber(round.round_number, runtime);
    if (isPre) {
      preCount += 1;
      displayByNumber.set(round.round_number, {
        display: preCount,
        isPre: true,
      });
    } else {
      officialCount += 1;
      displayByNumber.set(round.round_number, {
        display: officialCount,
        isPre: false,
      });
    }
  }
  return rounds.map((round) => {
    const meta = displayByNumber.get(round.round_number);
    return {
      round_number: round.round_number,
      is_pre_round: meta?.isPre ?? false,
      display_round_number: meta?.display ?? round.round_number,
    };
  });
}
function emptyPlayState(joinCode: string) {
  return {
    joinCode,
    currentRoundNumber: 0,
    tracks: [] as CuratedTrackRow[],
    trackCount: 0,
    activeRound: null as RoundRow | null,
    resultRound: null as RoundRow | null,
    pastRounds: [] as PastRoundRow[],
    roundGuesses: [] as GuessRow[],
    myGuessYear: null as number | null,
    myGuessWasNumberOne: null as boolean | null,
    leaderboard: [] as LeaderboardRow[],
    lastSubmittedByUserId: {} as Record<string, string>,
    memberCount: 0,
    roster: [] as QuizRosterMember[],
    teams: [] as QuizTeamInfo[],
    teamsLocked: false,
    resultTeamGroups: [] as TeamRoundGroup[],
    quizStatus: "open",
    maxCuratedTracks: DEFAULT_MAX_CURATED_TRACKS as number | null,
    settings: { ...DEFAULT_QUIZ_SETTINGS } as BeatageQuizSettings,
    autoInterrupted: false,
    autoEmptyStreak: 0,
    quizStarted: true,
    leaderboardRevealStep: 0,
    liveOpenMode: "automatic" as const,
    liveDeferredTrackKey: null as string | null,
  };
}

/**
 * Load host/play UI state.
 * Uses the service-role client after a membership check — same pattern as delete/leave.
 * User-scoped selects on beatage_curated_tracks often return [] under RLS even for hosts
 * when play policies/RPCs from 003 are not fully applied on the remote DB.
 */
export async function getQuizPlayState(
  quizId: string,
  joinCode: string,
  options?: { backfillReleaseYears?: boolean },
) {
  const { user } = await getOptionalUser();
  if (!user) {
    return emptyPlayState(joinCode);
  }

  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("beatage_quiz_members")
    .select("user_id, role")
    .eq("quiz_id", quizId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return emptyPlayState(joinCode);
  }

  const isHost = (membership as { role?: string }).role === "host";
  const isHostMember = isHost;

  const { data: quizMeta } = await admin
    .from("beatage_quizzes")
    .select("current_round_number, status, settings, source")
    .eq("id", quizId)
    .maybeSingle();

  const source =
    typeof (quizMeta as { source?: string } | null)?.source === "string"
      ? (quizMeta as { source: string }).source
      : "curated";
  const isLive = source === "spotify_live" || source === "lastfm_live";
  // Full playlist is only rendered for host + curated (non-live) quizzes.
  const needFullTracks = isHost && !isLive;

  // Reconcile first: maybeSingle() on two active rows returns nothing, so the
  // guess UI freezes on the last revealed round while new songs still ingest.
  let activeSlim: Awaited<ReturnType<typeof resolveActiveRound>> = null;
  try {
    activeSlim = await resolveActiveRound(quizId);
  } catch {
    activeSlim = null;
  }

  const [
    tracksResult,
    { data: activeRound },
    { data: revealedRoundsRaw },
    { data: allRoundMetaRaw },
    { data: members },
  ] = await Promise.all([
    needFullTracks
      ? admin
          .from("beatage_curated_tracks")
          .select(
            "id, sort_order, track_name, artist_name, release_year, spotify_track_id",
          )
          .eq("quiz_id", quizId)
          .order("sort_order", { ascending: true })
      : admin
          .from("beatage_curated_tracks")
          .select("id", { count: "exact", head: true })
          .eq("quiz_id", quizId),
    activeSlim
      ? admin
          .from("beatage_rounds")
          .select(ROUND_CORE_COLUMNS)
          .eq("id", activeSlim.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("beatage_rounds")
      .select(ROUND_CORE_COLUMNS)
      .eq("quiz_id", quizId)
      .in("status", ["revealed", "excluded", "skipped"])
      .order("round_number", { ascending: false }),
    admin
      .from("beatage_rounds")
      .select("round_number, status")
      .eq("quiz_id", quizId)
      .order("round_number", { ascending: true }),
    admin
      .from("beatage_quiz_members")
      .select("user_id, display_name, role")
      .eq("quiz_id", quizId),
  ]);

  const settings = resolveQuizSettings(
    (quizMeta as { settings?: unknown } | null)?.settings,
  );
  const runtime = readQuizSettingsRuntime(
    (quizMeta as { settings?: unknown } | null)?.settings,
  );
  const hideCorrectForViewer = !settings.showCorrectAnswer && !isHostMember;

  const storedRoundNumber =
    (quizMeta as { current_round_number?: number } | null)?.current_round_number ?? 0;
  const quizStatus =
    typeof (quizMeta as { status?: string } | null)?.status === "string"
      ? (quizMeta as { status: string }).status
      : "open";

  // Host curated: backfill missing release years (answers stay server-side until reveal).
  let curatedTracksRaw: Array<{
    id: string;
    sort_order: number;
    track_name: string;
    artist_name: string | null;
    release_year: number | null;
    spotify_track_id: string | null;
  }> = [];
  let trackCount = 0;

  if (needFullTracks) {
    curatedTracksRaw = ((tracksResult as { data?: unknown }).data ??
      []) as typeof curatedTracksRaw;
    trackCount = curatedTracksRaw.length;
    const shouldBackfill = options?.backfillReleaseYears !== false;
    if (
      shouldBackfill &&
      curatedTracksRaw.some((track) => track.release_year == null)
    ) {
      const filled = await backfillMissingReleaseYearsForQuiz(quizId, 8);
      if (filled > 0) {
        const { data: refreshed } = await admin
          .from("beatage_curated_tracks")
          .select(
            "id, sort_order, track_name, artist_name, release_year, spotify_track_id",
          )
          .eq("quiz_id", quizId)
          .order("sort_order", { ascending: true });
        curatedTracksRaw = (refreshed ?? []) as typeof curatedTracksRaw;
        trackCount = curatedTracksRaw.length;
      }
    }
  } else {
    trackCount =
      typeof (tracksResult as { count?: number | null }).count === "number"
        ? ((tracksResult as { count: number }).count ?? 0)
        : 0;
  }

  // Never send answer years to the client before reveal (host can play fairly).
  const curatedTracks: CuratedTrackRow[] = curatedTracksRaw.map((track) => ({
    id: track.id,
    sort_order: track.sort_order,
    track_name: track.track_name,
    artist_name: track.artist_name,
    has_release_year: track.release_year != null,
    release_year: null,
    original_release_year: null,
    album_art_url: null,
    spotify_track_id: track.spotify_track_id,
  }));

  type RoundCore = {
    id: string;
    round_number: number;
    status: string;
    track_name: string | null;
    artist_name: string | null;
    correct_release_year: number | null;
    original_release_year: number | null;
    spotify_track_id: string | null;
    chart_was_number_one: boolean | null;
    preview_url: string | null;
  };

  const toRoundRow = (
    round: RoundCore & {
      display_round_number: number;
      is_pre_round: boolean;
    },
    opts: {
      hideYears: boolean;
      previewUrl?: string | null;
      albumArtUrl?: string | null;
    },
  ): RoundRow => ({
    id: round.id,
    round_number: round.round_number,
    display_round_number: round.display_round_number,
    is_pre_round: round.is_pre_round,
    round_label: formatRoundLabel({
      isPreRound: round.is_pre_round,
      displayRoundNumber: round.display_round_number,
    }),
    status: round.status,
    track_name: round.track_name,
    artist_name: round.artist_name,
    has_correct_year: round.correct_release_year != null,
    correct_release_year: opts.hideYears ? null : round.correct_release_year,
    original_release_year: opts.hideYears ? null : round.original_release_year,
    album_art_url: opts.albumArtUrl ?? null,
    preview_url:
      opts.previewUrl !== undefined
        ? opts.previewUrl
        : (round.preview_url ?? null),
    spotify_track_id: round.spotify_track_id,
    chart_was_number_one: opts.hideYears
      ? null
      : typeof round.chart_was_number_one === "boolean"
        ? round.chart_was_number_one
        : null,
  });

  const historyListRaw = (revealedRoundsRaw ?? []) as RoundCore[];
  const allRoundMeta = assignDisplayRoundNumbers(
    ((allRoundMetaRaw ?? []) as Array<{ round_number: number; status: string }>),
    runtime,
  );
  // Live host UI uses official rounds for the plan cap. quiz.current_round_number
  // can be inflated by older pre-round increments and skipped warmup songs.
  const officialRoundCount = (
    (allRoundMetaRaw ?? []) as Array<{ round_number: number; status: string }>
  ).filter((round) => roundConsumesPlanCap(round, runtime)).length;
  const currentRoundNumber = isLive ? officialRoundCount : storedRoundNumber;
  const displayMetaByRoundNumber = new Map(
    allRoundMeta.map((r) => [
      r.round_number,
      {
        display_round_number: r.display_round_number,
        is_pre_round: r.is_pre_round,
      },
    ]),
  );
  const withDisplay = (round: RoundCore) => {
    // Always recompute from runtime — do not trust a stale meta false value.
    const isPre = isPreRoundNumber(round.round_number, runtime);
    const meta = displayMetaByRoundNumber.get(round.round_number);
    return {
      ...round,
      display_round_number:
        meta?.display_round_number ??
        (isPre
          ? allRoundMeta.filter(
              (r) => r.is_pre_round && r.round_number <= round.round_number,
            ).length || 1
          : allRoundMeta.filter(
              (r) => !r.is_pre_round && r.round_number <= round.round_number,
            ).length || 1),
      is_pre_round: isPre,
    };
  };

  const activeRoundPublic: RoundRow | null = activeRound
    ? toRoundRow(withDisplay(activeRound as RoundCore), {
        hideYears: true,
        // Do not expose preview audio while the round is still live.
        previewUrl: null,
      })
    : null;

  const revealedList = historyListRaw.map(withDisplay);
  const scoringRounds = revealedList.filter((r) => r.status === "revealed");
  const latestScoringRound = scoringRounds[0] ?? null;

  const resultRoundPublic: RoundRow | null = latestScoringRound
    ? toRoundRow(latestScoringRound, {
        hideYears: hideCorrectForViewer,
      })
    : null;

  let maxCuratedTracks: number | null = DEFAULT_MAX_CURATED_TRACKS;
  try {
    maxCuratedTracks = await getQuizCuratedTrackLimit(quizId);
  } catch {
    maxCuratedTracks = DEFAULT_MAX_CURATED_TRACKS;
  }

  let myGuessYear: number | null = null;
  let myGuessWasNumberOne: boolean | null = null;
  if (activeRoundPublic) {
    const { data: guess } = await admin
      .from("beatage_guesses")
      .select("guessed_year, guessed_was_number_one")
      .eq("round_id", activeRoundPublic.id)
      .eq("user_id", user.id)
      .maybeSingle();
    myGuessYear = (guess as { guessed_year?: number } | null)?.guessed_year ?? null;
    const chartGuess = (guess as { guessed_was_number_one?: boolean | null } | null)
      ?.guessed_was_number_one;
    myGuessWasNumberOne =
      typeof chartGuess === "boolean" ? chartGuess : null;
  }

  const nameByUser = new Map(
    ((members ?? []) as Array<{ user_id: string; display_name: string }>).map(
      (m) => [m.user_id, m.display_name] as const,
    ),
  );
  const roster: QuizRosterMember[] = (
    (members ?? []) as Array<{
      user_id: string;
      display_name: string;
      role: string;
    }>
  ).map((m) => ({
    user_id: m.user_id,
    display_name: m.display_name,
    role: m.role,
  }));

  let teams: QuizTeamInfo[] = [];
  let teamsLocked = false;
  if (settings.teamsEnabled) {
    try {
      const loaded = await loadQuizTeams(quizId);
      teams = loaded.teams;
      teamsLocked = loaded.locked;
    } catch {
      teams = [];
      teamsLocked = quizTeamsAreLocked({
        teamsEnabled: true,
        source,
        runtime,
        hasStartedOfficialRound: false,
      });
    }
  }

  let roundGuesses: GuessRow[] = [];
  const resultRound = resultRoundPublic;
  const guessesRound = activeRoundPublic ?? resultRound;
  if (guessesRound) {
    const { data: guesses } = await admin
      .from("beatage_guesses")
      .select(
        "user_id, guessed_year, guessed_was_number_one, points, points_total, submitted_at, points_breakdown",
      )
      .eq("round_id", guessesRound.id)
      .order("submitted_at", { ascending: false });

    // While a round is open, never send other players' years to the client
    // (host list only shows submitted / not submitted).
    const hideGuessYears = Boolean(activeRoundPublic);

    roundGuesses = ((guesses ?? []) as Array<{
      user_id: string;
      guessed_year: number | null;
      guessed_was_number_one: boolean | null;
      points: number | null;
      points_total: number | null;
      submitted_at: string | null;
      points_breakdown: unknown;
    }>)
      .filter((g) => !isLateJoinBreakdown(g.points_breakdown))
      .map((g) => ({
        user_id: g.user_id,
        display_name: nameByUser.get(g.user_id) ?? "Player",
        guessed_year: hideGuessYears ? null : g.guessed_year,
        guessed_was_number_one: hideGuessYears ? null : g.guessed_was_number_one,
        points_total: g.points_total ?? g.points ?? 0,
        submitted_at: g.submitted_at ?? "",
      }));

    if (!hideGuessYears) {
      const lowWins = scoringLowWins(settings);
      roundGuesses.sort((a, b) =>
        lowWins
          ? a.points_total - b.points_total || a.display_name.localeCompare(b.display_name)
          : b.points_total - a.points_total || a.display_name.localeCompare(b.display_name),
      );
    }
  }

  const resultTeamGroups =
    settings.teamsEnabled && resultRound && !activeRoundPublic
      ? buildTeamRoundGroups({
          teams,
          guesses: roundGuesses,
          viewerUserId: user.id,
          isHost: isHostMember,
          showOthers: settings.showOthersInPastResults,
          lowWins: scoringLowWins(settings),
        })
      : [];

  if (
    settings.teamsEnabled &&
    !activeRoundPublic &&
    !isHostMember &&
    roundGuesses.length > 0
  ) {
    const ownIds = new Set(
      teams.find((team) => team.member_user_ids.includes(user.id))
        ?.member_user_ids ?? [user.id],
    );
    roundGuesses = roundGuesses.filter((g) => ownIds.has(g.user_id));
  }

  const historyRoundIds = revealedList.map((r) => r.id);
  const officialScoringIds = new Set(
    scoringRounds.filter((r) => !r.is_pre_round).map((r) => r.id),
  );
  const pastGuessesByRound = new Map<string, GuessRow[]>();
  const allPastGuessesByRound = new Map<string, GuessRow[]>();
  const myPointsByRound = new Map<string, number>();
  const lateJoinByRound = new Map<string, LateJoinAssignment>();
  const participantScoresByRound = new Map<string, number[]>();
  const totals = new Map<string, number>();
  const lastRoundPts = new Map<string, number>();
  const lastSubmittedByUserId: Record<string, string> = {};
  // Official leaderboard "last round" = latest non-pre scored round.
  const latestOfficialScoringId =
    scoringRounds.find((r) => !r.is_pre_round)?.id ?? null;

  // Seed last-submit from the open/result round guesses (already loaded).
  for (const g of roundGuesses) {
    if (!g.submitted_at) continue;
    const prev = lastSubmittedByUserId[g.user_id];
    if (!prev || g.submitted_at > prev) {
      lastSubmittedByUserId[g.user_id] = g.submitted_at;
    }
  }

  if (historyRoundIds.length > 0) {
    // One query drives past-round details + leaderboard (was previously two).
    const { data: pastGuesses } = await admin
      .from("beatage_guesses")
      .select(
        "round_id, user_id, guessed_year, guessed_was_number_one, points, points_total, submitted_at, points_breakdown",
      )
      .in("round_id", historyRoundIds)
      .order("submitted_at", { ascending: false });

    for (const g of (pastGuesses ?? []) as Array<{
      round_id: string;
      user_id: string;
      guessed_year: number | null;
      guessed_was_number_one: boolean | null;
      points: number | null;
      points_total: number | null;
      submitted_at: string | null;
      points_breakdown: unknown;
    }>) {
      const pts = g.points_total ?? g.points ?? 0;
      const lateJoin = isLateJoinBreakdown(g.points_breakdown);
      if (g.user_id === user.id) {
        myPointsByRound.set(g.round_id, pts);
        const assignment = lateJoinAssignmentFromBreakdown(g.points_breakdown, pts);
        if (assignment) lateJoinByRound.set(g.round_id, assignment);
      }
      if (!lateJoin) {
        const scores = participantScoresByRound.get(g.round_id) ?? [];
        scores.push(pts);
        participantScoresByRound.set(g.round_id, scores);
      }
      // Pre-round scores are saved and shown in results, but do not count on the leaderboard.
      if (officialScoringIds.has(g.round_id)) {
        totals.set(g.user_id, (totals.get(g.user_id) ?? 0) + pts);
        if (latestOfficialScoringId && g.round_id === latestOfficialScoringId) {
          lastRoundPts.set(g.user_id, pts);
        }
      }
      if (g.submitted_at) {
        const prev = lastSubmittedByUserId[g.user_id];
        if (!prev || g.submitted_at > prev) {
          lastSubmittedByUserId[g.user_id] = g.submitted_at;
        }
      }
      // Late-join placeholders are not real guesses — hide them from round lists.
      if (lateJoin) continue;
      if (!settings.showResultDetails && !settings.teamsEnabled) continue;
      const fullRow: GuessRow = {
        user_id: g.user_id,
        display_name: nameByUser.get(g.user_id) ?? "Player",
        guessed_year: g.guessed_year,
        guessed_was_number_one: g.guessed_was_number_one,
        points_total: pts,
        submitted_at: g.submitted_at ?? "",
      };
      if (settings.teamsEnabled) {
        const all = allPastGuessesByRound.get(g.round_id) ?? [];
        all.push(fullRow);
        allPastGuessesByRound.set(g.round_id, all);
      }
      if (!settings.showResultDetails) continue;
      if (
        !isHostMember &&
        !settings.showOthersInPastResults &&
        g.user_id !== user.id &&
        !(
          settings.teamsEnabled &&
          teams.some(
            (team) =>
              team.member_user_ids.includes(user.id) &&
              team.member_user_ids.includes(g.user_id),
          )
        )
      ) {
        continue;
      }
      const list = pastGuessesByRound.get(g.round_id) ?? [];
      list.push(fullRow);
      pastGuessesByRound.set(g.round_id, list);
    }

    if (settings.showResultDetails) {
      const lowWins = scoringLowWins(settings);
      for (const [roundId, list] of pastGuessesByRound) {
        list.sort((a, b) =>
          lowWins
            ? a.points_total - b.points_total || a.display_name.localeCompare(b.display_name)
            : b.points_total - a.points_total || a.display_name.localeCompare(b.display_name),
        );
        pastGuessesByRound.set(roundId, list);
      }
    }
  }

  const viewerGuesses = isScoringQuizMember(
    { role: (membership as { role?: string }).role ?? "participant" },
    settings.hostParticipates,
  );
  if (viewerGuesses) {
    const lowWins = scoringLowWins(settings);
    const now = new Date().toISOString();
    const pendingLateJoinRows: Array<{
      quiz_id: string;
      round_id: string;
      user_id: string;
      guessed_year: null;
      guessed_was_number_one: null;
      points: number;
      points_total: number;
      points_breakdown: Record<string, unknown>;
      submitted_at: string;
    }> = [];
    for (const round of revealedList) {
      if (round.status !== "revealed") continue;
      if (myPointsByRound.has(round.id)) continue;
      const assignment = lateJoinAssignedPoints(
        participantScoresByRound.get(round.id) ?? [],
        lowWins,
      );
      myPointsByRound.set(round.id, assignment.assignedPoints);
      lateJoinByRound.set(round.id, assignment);
      if (officialScoringIds.has(round.id)) {
        totals.set(user.id, (totals.get(user.id) ?? 0) + assignment.assignedPoints);
        if (latestOfficialScoringId && round.id === latestOfficialScoringId) {
          lastRoundPts.set(user.id, assignment.assignedPoints);
        }
      }
      pendingLateJoinRows.push({
        quiz_id: quizId,
        round_id: round.id,
        user_id: user.id,
        guessed_year: null,
        guessed_was_number_one: null,
        points: assignment.assignedPoints,
        points_total: assignment.assignedPoints,
        points_breakdown: lateJoinBreakdownPayload(assignment),
        submitted_at: now,
      });
    }
    if (pendingLateJoinRows.length > 0) {
      await admin.from("beatage_guesses").upsert(pendingLateJoinRows, {
        onConflict: "round_id,user_id",
        ignoreDuplicates: true,
      });
    }
  }

  const pastRounds: PastRoundRow[] = revealedList.map((round) => {
    const hideYears = hideCorrectForViewer || !settings.showResultDetails;
    const isSkipped = round.status === "skipped";
    const base = toRoundRow(round, {
      hideYears: hideYears || isSkipped,
    });
    return {
      ...base,
      my_points:
        isSkipped
          ? null
          : myPointsByRound.has(round.id)
            ? (myPointsByRound.get(round.id) as number)
            : null,
      lateJoinAssigned: isSkipped ? null : (lateJoinByRound.get(round.id) ?? null),
      guesses:
        isSkipped || !settings.showResultDetails
          ? []
          : (pastGuessesByRound.get(round.id) ?? []),
      teamGroups:
        isSkipped || !settings.teamsEnabled
          ? []
          : buildTeamRoundGroups({
              teams,
              guesses: allPastGuessesByRound.get(round.id) ?? [],
              viewerUserId: user.id,
              isHost: isHostMember,
              showOthers: settings.showOthersInPastResults,
              lowWins: scoringLowWins(settings),
            }),
    };
  });

  let leaderboard: LeaderboardRow[] = [];
  if (officialScoringIds.size > 0) {
    if (settings.teamsEnabled) {
      leaderboard = buildTeamLeaderboard({
        teams,
        totals,
        lastRoundPts,
        lowWins: scoringLowWins(settings),
      });
    } else {
      leaderboard = [...totals.entries()]
        .map(([userId, total_points]) => ({
          user_id: userId,
          display_name: nameByUser.get(userId) ?? "Player",
          total_points,
          last_round_points: lastRoundPts.get(userId) ?? 0,
        }))
        .sort((a, b) => {
          const byPoints = scoringLowWins(settings)
            ? a.total_points - b.total_points
            : b.total_points - a.total_points;
          return byPoints || a.display_name.localeCompare(b.display_name);
        });
    }
  }

  return {
    joinCode,
    currentRoundNumber,
    tracks: curatedTracks,
    trackCount,
    activeRound: activeRoundPublic,
    resultRound,
    pastRounds,
    roundGuesses,
    myGuessYear,
    myGuessWasNumberOne,
    leaderboard,
    lastSubmittedByUserId: isHost ? lastSubmittedByUserId : {},
    memberCount: ((members ?? []) as Array<{ user_id: string }>).length,
    roster,
    teams,
    teamsLocked,
    resultTeamGroups,
    quizStatus,
    maxCuratedTracks,
    settings,
    autoInterrupted: Boolean(runtime.autoInterrupted),
    autoEmptyStreak: runtime.autoEmptyStreak ?? 0,
    quizStarted: runtime.quizStarted !== false,
    leaderboardRevealStep: runtime.leaderboardRevealStep ?? 0,
    liveOpenMode: runtime.liveOpenMode === "manual" ? "manual" : "automatic",
    liveDeferredTrackKey: runtime.liveDeferredTrackKey ?? null,
  };
}
