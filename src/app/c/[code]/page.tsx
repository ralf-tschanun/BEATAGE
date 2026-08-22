import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { CandidatesList } from "@/components/candidates-list";
import { ContestCreatedBanner } from "@/components/contest-created-banner";
import { ContestLiveRefresh } from "@/components/contest-live-refresh";
import {
  ContestPhasePanels,
} from "@/components/contest-phase-panels";
import { ContestPageHeader } from "@/components/contest-page-header";
import { ContestParticipantTabs } from "@/components/contest-participant-tabs";
import { ContestRulesContent } from "@/components/contest-rules-content";
import { NominateTabPanel } from "@/components/nominate-tab-panel";
import { SiteHeader } from "@/components/site-header";
import {
  resolveAccountDisplayName,
  shouldRepairHostPollutedProfile,
} from "@/lib/account-display-name";
import { CollapsibleCard } from "@/components/collapsible-card";
import { ContestSectionCard } from "@/components/contest-section-card";
import { LiveColoredNominationStatus } from "@/components/nomination-status-badge";
import {
  LiveStandardCandidatesDescription,
  LiveVoteSectionTitle,
} from "@/components/candidates-vote-section-chrome";
import { EmbeddedContestBallot } from "@/components/embedded-contest-ballot";
import { ParticipantsList } from "@/components/participants-list";
import {
  computeNominatorResults,
  computeResults,
  ballotsForQuestion,
  isBestOnlyModel,
  isEmbeddedBallotModel,
  isInlineRankChipsModel,
  isStarRatingModel,
  orderVotersForBallotReveal,
  nominatorRevealMode,
  parseStarRatings,
  parseNominatorResultsReveal,
  resultsRevealMaxStep,
  birthdayIdentitiesRevealed,
  isCuratedBirthdayContest,
  isExcludedOwnNomination,
  isParticipantNomination,
  allowsNominatorRanking,
  anonymousParticipantLabel,
  sortCandidates,
  parseSongLinksMode,
  parseCandidateSort,
  type BallotRevealOrder,
  type CandidateReveal,
  parseCandidateReveal,
  isAdminCandidateReveal,
  isDeferredCandidateReveal,
  type CandidateSort,
  type CandidateSource,
  type ContestTheme,
  type NominatorRankingWhen,
  type PlanId,
  type ResultsPhase,
  type ResultsReveal,
  type ScoringModelId,
  type VoteMutability,
  type VotingCloseMode,
  type NominationKind,
  getPlanLimits,
} from "@/lib/plans";
import type { ChartCountry } from "@/lib/charts";
import { parseChartCountry } from "@/lib/charts";
import { flushPendingContestPhotoDeletes } from "@/lib/contest-photos";
import {
  contestTabCookieName,
  parseContestTabId,
} from "@/lib/contest-tab-persist";
import { getOptionalUser } from "@/lib/supabase/auth";
import {
  DEFAULT_TOPIC_NAME,
  effectiveCandidateTitle,
  effectiveTopicName,
} from "@/lib/create-wizard";

type ContestPageProps = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{
    created?: string;
    nominated?: string;
    voting?: string;
    voted?: string;
    results?: string;
    revealed?: string;
    billing?: string;
  }>;
};

export default async function ContestPage({ params, searchParams }: ContestPageProps) {
  const { code } = await params;
  const { created, nominated, voting, voted, results, revealed, billing } = await searchParams;
  const joinCode = code.trim().toUpperCase();
  const { supabase, user } = await getOptionalUser();

  if (!user) {
    redirect(`/j/${joinCode}`);
  }

  const { data: contestRow, error } = await supabase
    .from("contests")
    .select(
      `
      id, title, description, status, mode, max_members, join_code, manage_token,
      expires_at, created_at, host_user_id, candidate_source, max_nominations_per_participant,
      max_candidates, allow_duplicate_candidates, nomination_deadline, candidate_reveal,
      vote_mutability, voting_close_mode, voting_closes_at, scoring_model,
      nominations_open, voting_open, host_participates, theme,
      results_reveal, results_reveal_step,
      nominator_ranking, nominator_ranking_when, nominator_results_reveal, results_phase, nominator_reveal_step,
      candidate_sort, allow_vote_own_nominations, ballot_reveal_order,
      nomination_kind, chart_country, nominations_reopened_at, voting_reopened_at, birthday_offset_amount, birthday_offset_unit, song_links,
      results_anonymous, candidate_title, show_star_points, show_nominees, nomination_duration_seconds, unlocked_at
    `,
    )
    .eq("join_code", joinCode)
    .maybeSingle();

  if (error) {
    // Migration 009/011/013 not applied yet — show a clear message instead of a white screen.
    if (
      error.message.includes("candidate_source") ||
      error.message.includes("host_participates") ||
      error.message.includes("theme") ||
      error.message.includes("does not exist")
    ) {
      return (
        <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-4 px-6 py-16">
          <h1 className="text-2xl font-semibold">Database update required</h1>
          <p className="text-muted-foreground">
            Please run the latest SQL migrations in the Supabase SQL editor
            (through{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              supabase/migrations/030_birthday_update_and_privacy.sql
            </code>
            ), then reload this page.
          </p>
          <p className="text-sm text-muted-foreground">Details: {error.message}</p>
          <Link href="/" className="text-sm underline-offset-2 hover:underline">
            ← Back to BEATAGE
          </Link>
        </main>
      );
    }
    throw new Error(error.message);
  }

  if (!contestRow) {
    // After a host remove, RLS hides the contest. Do not send the user to /j/CODE
    // (prefilled join) — they must enter or scan the code again from /join.
    const { data: wasRemoved } = await supabase.rpc("was_removed_from_contest", {
      p_join_code: joinCode,
    });
    if (wasRemoved === true) {
      redirect("/?removed=1");
    }
    redirect(`/j/${joinCode}`);
  }

  if (contestRow.status === "payment_pending") {
    if (contestRow.host_user_id === user.id) {
      redirect(
        `/api/billing/checkout?sku=contest_unlock&contestId=${encodeURIComponent(contestRow.id)}`,
      );
    }
    redirect(`/j/${joinCode}`);
  }

  let contest = contestRow;

  if (contest.nominations_open && contest.nomination_deadline) {
    const { data: nomsClosed } = await supabase.rpc(
      "maybe_auto_close_nominations",
      { p_contest_id: contest.id },
    );
    if (nomsClosed) {
      const { data: refreshed } = await supabase
        .from("contests")
        .select(
          `
      id, title, description, status, mode, max_members, join_code, manage_token,
      expires_at, created_at, host_user_id, candidate_source, max_nominations_per_participant,
      max_candidates, allow_duplicate_candidates, nomination_deadline, candidate_reveal,
      vote_mutability, voting_close_mode, voting_closes_at, scoring_model,
      nominations_open, voting_open, host_participates, theme,
      results_reveal, results_reveal_step,
      nominator_ranking, nominator_ranking_when, nominator_results_reveal, results_phase, nominator_reveal_step,
      candidate_sort, allow_vote_own_nominations, ballot_reveal_order,
      nomination_kind, chart_country, nominations_reopened_at, voting_reopened_at, birthday_offset_amount, birthday_offset_unit, song_links,
      results_anonymous, candidate_title, show_star_points, show_nominees, nomination_duration_seconds, unlocked_at
    `,
        )
        .eq("id", contest.id)
        .maybeSingle();
      if (refreshed) {
        contest = refreshed;
      }
    }
  }

  if (contest.status === "voting") {
    const { data: closed } = await supabase.rpc("maybe_auto_close_voting", {
      p_contest_id: contest.id,
    });
    if (closed) {
      const { data: refreshed } = await supabase
        .from("contests")
        .select(
          `
      id, title, description, status, mode, max_members, join_code, manage_token,
      expires_at, created_at, host_user_id, candidate_source, max_nominations_per_participant,
      max_candidates, allow_duplicate_candidates, nomination_deadline, candidate_reveal,
      vote_mutability, voting_close_mode, voting_closes_at, scoring_model,
      nominations_open, voting_open, host_participates, theme,
      results_reveal, results_reveal_step,
      nominator_ranking, nominator_ranking_when, nominator_results_reveal, results_phase, nominator_reveal_step,
      candidate_sort, allow_vote_own_nominations, ballot_reveal_order,
      nomination_kind, chart_country, nominations_reopened_at, voting_reopened_at, birthday_offset_amount, birthday_offset_unit, song_links,
      results_anonymous, candidate_title, show_star_points, show_nominees, nomination_duration_seconds, unlocked_at
    `,
        )
        .eq("id", contest.id)
        .maybeSingle();
      if (refreshed) {
        contest = refreshed;
      }
    }
  }

  const [
    { data: members, error: membersError },
    candidatesResult,
    ballotsResult,
    turnoutResult,
    birthdayResult,
    curatedBirthdayResult,
    questionsResult,
  ] = await Promise.all([
    supabase
      .from("contest_members")
      .select("id, display_name, role, joined_at, user_id")
      .eq("contest_id", contest.id)
      .order("joined_at", { ascending: true }),
    supabase
      .from("candidates")
      .select(
        "id, title, artist, url, description, status, nominator_user_id, created_at, display_order, chart_key, chart_date, delete_photo_on_finish, meta, question_id",
      )
      .eq("contest_id", contest.id)
      .neq("status", "withdrawn")
      .order("created_at", { ascending: true }),
    supabase
      .from("ballots")
      .select("id, voter_user_id, rankings, ratings, submitted_at, updated_at, question_id")
      .eq("contest_id", contest.id),
    supabase
      .from("ballot_turnout")
      .select("voter_user_id, submitted_at, updated_at, ballot_count")
      .eq("contest_id", contest.id),
    supabase
      .from("birthday_nominations")
      .select("user_id, birthday, show_birthday, candidate_id")
      .eq("contest_id", contest.id),
    supabase
      .from("curated_birthday_entries")
      .select("id, display_name, birthday, candidate_id, sort_order, created_at")
      .eq("contest_id", contest.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("contest_questions")
      .select("id, name, sort_order")
      .eq("contest_id", contest.id)
      .order("sort_order", { ascending: true }),
  ]);

  if (membersError) {
    throw new Error(membersError.message);
  }

  const candidatesRaw = candidatesResult.error ? [] : (candidatesResult.data ?? []);
  const candidatesErrorMessage = candidatesResult.error?.message ?? null;
  const ballots = ballotsResult.error ? [] : (ballotsResult.data ?? []);
  const ballotsErrorMessage = ballotsResult.error?.message ?? null;
  const turnoutRows = turnoutResult.error ? [] : (turnoutResult.data ?? []);
  const birthdayRows = birthdayResult.error ? [] : (birthdayResult.data ?? []);
  const curatedBirthdayRows = curatedBirthdayResult.error
    ? []
    : (curatedBirthdayResult.data ?? []);
  const contestQuestions = (questionsResult.error ? [] : (questionsResult.data ?? [])).map(
    (row) => ({
      id: row.id as string,
      name: effectiveTopicName(row.name as string),
    }),
  );
  const topicNames =
    contestQuestions.length > 0
      ? contestQuestions.map((question) => question.name)
      : [DEFAULT_TOPIC_NAME];
  const candidateTitleLabel = effectiveCandidateTitle(
    (contest as { candidate_title?: string | null }).candidate_title,
  );
  // Prefer turnout (visible to all members during voting); fall back to ballots for host.

  if (!members?.length) {
    notFound();
  }

  const rawCandidateSort = (contest as { candidate_sort?: string }).candidate_sort;
  const candidateSort: CandidateSort = parseCandidateSort(rawCandidateSort);
  const candidates = sortCandidates(candidatesRaw, candidateSort);

  const isHost = contest.host_user_id === user.id;
  const me = members.find((member) => member.user_id === user.id);
  const memberNameByUserId = new Map(
    members.map((member) => [member.user_id, member.display_name] as const),
  );

  const { data: removedMembersData } = isHost
    ? await supabase
        .from("contest_removed_members")
        .select("id, user_id, display_name, joined_at, removed_at")
        .eq("contest_id", contest.id)
        .order("removed_at", { ascending: false })
    : { data: [] as Array<{
        id: string;
        user_id: string;
        display_name: string;
        joined_at: string;
        removed_at: string;
      }> };

  const removedMembers = (removedMembersData ?? []).map((row) => ({
    id: row.id as string,
    userId: row.user_id as string,
    displayName: row.display_name as string,
    joinedAt: (row.joined_at as string | null) ?? null,
    removedAt: (row.removed_at as string | null) ?? null,
  }));

  const { data: removedCandidatesData } = isHost
    ? await supabase
        .from("contest_removed_candidates")
        .select(
          "id, candidate_id, title, artist, url, description, nominator_display_name, removed_at",
        )
        .eq("contest_id", contest.id)
        .order("removed_at", { ascending: false })
    : {
        data: [] as Array<{
          id: string;
          candidate_id: string;
          title: string;
          artist: string | null;
          url: string | null;
          description: string | null;
          nominator_display_name: string;
          removed_at: string;
        }>,
      };

  const removedCandidates = (removedCandidatesData ?? []).map((row) => ({
    id: row.id as string,
    candidateId: row.candidate_id as string,
    title: row.title as string,
    artist: (row.artist as string | null) ?? null,
    url: (row.url as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    nominatorDisplayName: row.nominator_display_name as string,
    removedAt: (row.removed_at as string | null) ?? null,
  }));

  if (
    isHost &&
    contest.status === "finished" &&
    (contest as { results_phase?: string | null }).results_phase === "done"
  ) {
    try {
      await flushPendingContestPhotoDeletes(supabase, contest.id);
    } catch {
      // Best-effort Storage cleanup; URLs are already cleared in the DB.
    }
  }

  let viewerPlanId: PlanId = "free";
  let accountDisplayName: string | null = null;
  {
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan, display_name")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.plan === "plus" || profile?.plan === "pro") {
      viewerPlanId = profile.plan;
    }
    accountDisplayName = resolveAccountDisplayName(user, profile?.display_name);
    const repairedName = shouldRepairHostPollutedProfile(
      profile?.display_name,
      user,
    );
    if (repairedName) {
      await supabase
        .from("profiles")
        .update({
          display_name: repairedName,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);
      accountDisplayName = repairedName;
    }
  }
  const hostPlanId = isHost ? viewerPlanId : "free";
  const myCandidates = candidates.filter(
    (candidate) => candidate.nominator_user_id === user.id,
  );

  const canNominateUser =
    ["user_single", "user_multiple", "combined"].includes(contest.candidate_source) &&
    !(isHost && contest.host_participates === false);

  const canNominateCurated =
    isHost &&
    (contest.candidate_source === "curated" ||
      contest.candidate_source === "combined");

  const canNominateEligible = canNominateUser || canNominateCurated;

  const canShowNominateForm =
    contest.nominations_open && canNominateEligible;

  const theme = ((contest as { theme?: string }).theme as ContestTheme) || "generic";
  const songLinks = parseSongLinksMode(
    (contest as { song_links?: string }).song_links,
  );
  const source = contest.candidate_source as CandidateSource;
  const rawReveal = contest.candidate_reveal as string;
  const reveal: CandidateReveal = parseCandidateReveal(rawReveal);
  const scoring = contest.scoring_model as ScoringModelId;
  const voteMutability = contest.vote_mutability as VoteMutability;
  const rawResultsReveal = (contest as { results_reveal?: string }).results_reveal;
  const resultsReveal: ResultsReveal =
    rawResultsReveal === "last_to_first" ||
    rawResultsReveal === "by_participant" ||
    rawResultsReveal === "live"
      ? rawResultsReveal
      : "immediate";
  const rawBallotRevealOrder = (contest as { ballot_reveal_order?: string })
    .ballot_reveal_order;
  const ballotRevealOrder: BallotRevealOrder =
    rawBallotRevealOrder === "first_submitted" ||
    rawBallotRevealOrder === "last_submitted" ||
    rawBallotRevealOrder === "random"
      ? rawBallotRevealOrder
      : "alphabetical";
  const resultsAnonymous =
    (contest as { results_anonymous?: boolean }).results_anonymous === true;
  const showStarPoints =
    (contest as { show_star_points?: boolean }).show_star_points === true;
  const showNominees =
    (contest as { show_nominees?: boolean }).show_nominees === true;
  const resultsRevealStep = Number(
    (contest as { results_reveal_step?: number }).results_reveal_step ?? 0,
  ) || 0;
  const nominationKind: NominationKind =
    (contest as { nomination_kind?: string }).nomination_kind === "birthday"
      ? "birthday"
      : "standard";
  const nominatorRanking =
    Boolean((contest as { nominator_ranking?: boolean }).nominator_ranking) &&
    allowsNominatorRanking(source, nominationKind);
  const rawNominatorWhen = (contest as { nominator_ranking_when?: string })
    .nominator_ranking_when;
  const nominatorRankingWhen: NominatorRankingWhen =
    rawNominatorWhen === "before" || rawNominatorWhen === "parallel"
      ? rawNominatorWhen
      : "after";
  const nominatorResultsReveal = parseNominatorResultsReveal(
    (contest as { nominator_results_reveal?: string }).nominator_results_reveal,
  );
  const allowVoteOwnNominations =
    (contest as { allow_vote_own_nominations?: boolean }).allow_vote_own_nominations !==
    false;
  const chartCountry: ChartCountry = parseChartCountry(
    (contest as { chart_country?: string }).chart_country,
  );
  const isCuratedBirthday = isCuratedBirthdayContest(nominationKind, source);
  /** Participant nominations exist → show Nominate tab (not curated-only / birthday). */
  const showNominateTab =
    nominationKind !== "birthday" &&
    (source === "user_single" ||
      source === "user_multiple" ||
      source === "combined");
  const rawPhase = (contest as { results_phase?: string }).results_phase;
  const resultsPhase: ResultsPhase =
    rawPhase === "nominators" || rawPhase === "done" ? rawPhase : "candidates";
  const nominatorRevealStep = Number(
    (contest as { nominator_reveal_step?: number }).nominator_reveal_step ?? 0,
  ) || 0;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  const joinUrl = siteUrl
    ? `${siteUrl}/j/${contest.join_code}`
    : `/j/${contest.join_code}`;

  const votingCandidates = candidates.filter(
    (candidate) => candidate.status === "in_voting",
  );
  const pendingCandidates = candidates.filter(
    (candidate) => candidate.status === "pending",
  );
  const needsAdminReveal = isAdminCandidateReveal(reveal);
  const deferredCandidateReveal = isDeferredCandidateReveal(reveal);
  const myBallots = ballots.filter((ballot) => ballot.voter_user_id === user.id);
  const myRankingsByQuestion: Record<string, string[]> = {};
  for (const ballot of myBallots) {
    const qid = (ballot as { question_id?: string | null }).question_id;
    if (!qid || !Array.isArray(ballot.rankings)) continue;
    myRankingsByQuestion[qid] = ballot.rankings as string[];
  }
  const myLegacyBallot =
    myBallots.find(
      (ballot) => !(ballot as { question_id?: string | null }).question_id,
    ) ?? (contestQuestions.length === 0 ? myBallots[0] : undefined);
  const myRankings = Array.isArray(myLegacyBallot?.rankings)
    ? (myLegacyBallot.rankings as string[])
    : null;
  const myRatings: Record<string, number> = {};
  for (const ballot of myBallots) {
    const parsed = parseStarRatings((ballot as { ratings?: unknown }).ratings);
    Object.assign(myRatings, parsed);
  }

  const myBestPicks: Record<string, string> = {};
  if (isBestOnlyModel(scoring)) {
    if (contestQuestions.length > 0) {
      for (const [qid, rankings] of Object.entries(myRankingsByQuestion)) {
        if (rankings[0]) myBestPicks[qid] = rankings[0];
      }
    } else if (myRankings?.[0]) {
      myBestPicks[""] = myRankings[0];
    }
  }
  const myBestPicksSubmitted = Object.keys(myBestPicks).length > 0;

  const canVoteAsParticipant = !(isHost && contest.host_participates === false);
  const myVoteSubmitted =
    canVoteAsParticipant &&
    (isStarRatingModel(scoring)
      ? Object.keys(myRatings).length > 0
      : isBestOnlyModel(scoring)
        ? myBestPicksSubmitted
        : contestQuestions.length > 0
          ? contestQuestions.every(
              (question) =>
                (myRankingsByQuestion[question.id]?.length ?? 0) > 0,
            )
          : Boolean(myRankings?.length));

  const submittedAtByUserId = Object.fromEntries(
    ballots.map((ballot) => [
      ballot.voter_user_id as string,
      (ballot.submitted_at as string | null) ??
        (ballot.updated_at as string | null) ??
        null,
    ]),
  );

  const birthdayByCandidateId = new Map<string, string[]>();
  const birthdayNominatorIdsByCandidateId = new Map<string, string[]>();
  for (const row of birthdayRows) {
    if (!row.candidate_id) continue;
    const userIds = birthdayNominatorIdsByCandidateId.get(row.candidate_id) ?? [];
    userIds.push(row.user_id);
    birthdayNominatorIdsByCandidateId.set(row.candidate_id, userIds);
  }
  const showBirthdaysInResults =
    birthdayRows.length > 0 && birthdayRows.every((row) => row.show_birthday === true);
  if (showBirthdaysInResults) {
    for (const row of birthdayRows) {
      if (!row.candidate_id || !row.birthday) continue;
      const labels = birthdayByCandidateId.get(row.candidate_id) ?? [];
      const name = memberNameByUserId.get(row.user_id) ?? "Someone";
      labels.push(`${name} (${row.birthday})`);
      birthdayByCandidateId.set(row.candidate_id, labels);
    }
  }
  const birthdayLabelsByCandidateId = Object.fromEntries(birthdayByCandidateId);
  const myBirthdaySubmitted = birthdayRows.some((row) => row.user_id === user.id);
  const myBirthdayRow = birthdayRows.find((row) => row.user_id === user.id);
  const myBirthdayHadChartMatch = myBirthdayRow
    ? Boolean(myBirthdayRow.candidate_id)
    : null;
  const myBirthdayCandidateIds = new Set(
    birthdayRows
      .filter((row) => row.user_id === user.id && row.candidate_id)
      .map((row) => row.candidate_id as string),
  );
  const linkedNominatorNamesByCandidateId = Object.fromEntries(
    [...birthdayNominatorIdsByCandidateId.entries()].map(([candidateId, userIds]) => [
      candidateId,
      userIds.map((id) => memberNameByUserId.get(id) ?? "Someone"),
    ]),
  );

  const curatedEntryIdsByCandidateId = new Map<string, string[]>();
  const curatedEntryNameByKey: Record<string, string> = {};
  for (const row of curatedBirthdayRows) {
    curatedEntryNameByKey[`entry:${row.id}`] = row.display_name as string;
    if (!row.candidate_id) continue;
    const ids = curatedEntryIdsByCandidateId.get(row.candidate_id as string) ?? [];
    ids.push(row.id as string);
    curatedEntryIdsByCandidateId.set(row.candidate_id as string, ids);
  }

  // Curated birth dates are never shown in results (no participant consent).
  const curatedBirthdayEntries = curatedBirthdayRows.map((row) => ({
    id: row.id as string,
    displayName: row.display_name as string,
    birthday: row.birthday as string,
    candidateId: (row.candidate_id as string | null) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
  }));

  const hostCuratedLabelsByCandidateId: Record<string, string[]> = {};
  if (isCuratedBirthday) {
    for (const row of curatedBirthdayRows) {
      if (!row.candidate_id || !row.birthday) continue;
      const labels = hostCuratedLabelsByCandidateId[row.candidate_id as string] ?? [];
      labels.push(`${row.display_name as string} · ${row.birthday}`);
      hostCuratedLabelsByCandidateId[row.candidate_id as string] = labels;
    }
  }

  const remainingCuratedEntries =
    isCuratedBirthday && contest.max_candidates !== null
      ? Math.max(0, contest.max_candidates - curatedBirthdayRows.length)
      : isCuratedBirthday
        ? null
        : null;

  const myParticipantNominations = myCandidates.filter((candidate) =>
    isParticipantNomination(
      {
        nominator_user_id: candidate.nominator_user_id,
        meta: ((candidate as { meta?: Record<string, unknown> }).meta ??
          {}) as Record<string, unknown>,
      },
      source,
      contest.host_user_id as string,
    ),
  );

  const remainingNominations =
    isCuratedBirthday
      ? remainingCuratedEntries
      : nominationKind === "birthday"
      ? myBirthdaySubmitted
        ? 0
        : 1
      : contest.candidate_source === "curated" ||
          (contest.candidate_source === "combined" &&
            isHost &&
            contest.host_participates === false)
        ? contest.max_candidates === null
          ? null
          : Math.max(0, contest.max_candidates - candidates.length)
        : contest.max_nominations_per_participant === null
          ? null
          : Math.max(
              0,
              contest.max_nominations_per_participant -
                myParticipantNominations.length,
            );

  const nextNominationNumber =
    contest.candidate_source === "curated" ||
    (contest.candidate_source === "combined" &&
      isHost &&
      contest.host_participates === false)
      ? candidates.filter((c) => c.status !== "withdrawn" && c.status !== "rejected")
          .length + 1
      : myParticipantNominations.length + 1;

  const visibleCandidates = candidates.filter((candidate) => {
    if (isHost) return true;
    if (nominationKind === "birthday") {
      return candidate.status === "visible" || candidate.status === "in_voting";
    }
    if (candidate.nominator_user_id === user.id) return true;
    if (myBirthdayCandidateIds.has(candidate.id)) return true;
    return candidate.status === "visible" || candidate.status === "in_voting";
  });

  const eligibleOrdered = orderVotersForBallotReveal(
    members.map((member) => ({
      userId: member.user_id,
      role: member.role,
      displayName: member.display_name,
      joinedAt: member.joined_at,
    })),
    contest.host_participates !== false,
    ballotRevealOrder,
    {
      submittedAtByUserId,
      seed: contest.id,
    },
  );
  const resultsMaxStep = resultsRevealMaxStep(
    resultsReveal,
    votingCandidates.length,
    eligibleOrdered.length,
  );

  let scoredBallots = ballots.map((ballot) => ({
    voterUserId: ballot.voter_user_id as string,
    rankings: Array.isArray(ballot.rankings) ? (ballot.rankings as string[]) : [],
    ratings: parseStarRatings((ballot as { ratings?: unknown }).ratings),
    questionId:
      ((ballot as { question_id?: string | null }).question_id as string | null) ??
      null,
  }));
  const resultsSubtitle: string | null = null;
  let resultAfterPresenters: Array<{ userId: string; displayName: string }> | null =
    null;

  if (contest.status === "finished" && resultsReveal === "by_participant") {
    const included = eligibleOrdered.slice(0, Math.max(0, resultsRevealStep));
    const includedIds = new Set(included.map((member) => member.userId));
    scoredBallots = scoredBallots.filter((ballot) =>
      includedIds.has(ballot.voterUserId),
    );
    if (included.length > 0) {
      resultAfterPresenters = included.map((member, index) => ({
        userId: member.userId,
        displayName: resultsAnonymous
          ? anonymousParticipantLabel(index)
          : member.displayName,
      }));
    }
  }

  const candidateForResults = (candidate: (typeof votingCandidates)[number]) => ({
    id: candidate.id,
    title: candidate.title,
    artist: candidate.artist,
    url: candidate.url,
    questionId:
      ((candidate as { question_id?: string | null }).question_id as
        | string
        | null) ?? null,
  });

  const candidatesForQuestionResults = <
    T extends { questionId?: string | null },
  >(
    list: T[],
    questionId: string,
  ): T[] => {
    const scoped = list.filter((candidate) => candidate.questionId === questionId);
    const shared = list.filter((candidate) => !candidate.questionId);
    if (scoped.length > 0) return [...scoped, ...shared];
    return shared;
  };

  const showLiveResultsNow =
    resultsReveal === "live" && contest.status === "voting";
  const showComputedResults =
    contest.status === "finished" || showLiveResultsNow;

  const fullResultRows =
    showComputedResults && contestQuestions.length === 0
      ? computeResults(
          scoring,
          votingCandidates.map(candidateForResults),
          scoredBallots.map((ballot) => ({
            rankings: ballot.rankings,
            ratings: ballot.ratings,
          })),
        )
      : [];

  const fullResultRowsByQuestion =
    showComputedResults && contestQuestions.length > 0
      ? Object.fromEntries(
          contestQuestions.map((question) => {
            const questionCandidates = candidatesForQuestionResults(
              votingCandidates.map(candidateForResults),
              question.id,
            );
            const questionBallots = ballotsForQuestion(scoredBallots, question.id);
            return [
              question.id,
              computeResults(
                scoring,
                questionCandidates,
                questionBallots.map((ballot) => ({
                  rankings: ballot.rankings,
                  ratings: ballot.ratings,
                })),
              ),
            ] as const;
          }),
        )
      : {};

  // Nominator ranking always uses the final full ballot set (not partial reveal).
  const fullFinalCandidateRows =
    contest.status === "finished"
      ? contestQuestions.length > 0
        ? contestQuestions.flatMap((question) => {
            const questionCandidates = candidatesForQuestionResults(
              votingCandidates.map(candidateForResults),
              question.id,
            );
            const questionBallots = ballotsForQuestion(
              ballots.map((ballot) => ({
                rankings: Array.isArray(ballot.rankings)
                  ? (ballot.rankings as string[])
                  : [],
                ratings: parseStarRatings((ballot as { ratings?: unknown }).ratings),
                questionId:
                  ((ballot as { question_id?: string | null }).question_id as
                    | string
                    | null) ?? null,
              })),
              question.id,
            );
            return computeResults(
              scoring,
              questionCandidates,
              questionBallots,
            );
          })
        : computeResults(
            scoring,
            votingCandidates.map(candidateForResults),
            ballots.map((ballot) => ({
              rankings: Array.isArray(ballot.rankings)
                ? (ballot.rankings as string[])
                : [],
              ratings: parseStarRatings((ballot as { ratings?: unknown }).ratings),
            })),
          )
      : [];

  const nominatorComputeCandidates = votingCandidates.map((candidate) => ({
    id: candidate.id,
    nominatorUserId: candidate.nominator_user_id,
    meta: ((candidate as { meta?: Record<string, unknown> }).meta ??
      null) as Record<string, unknown> | null,
    nominatorUserIds:
      nominationKind === "birthday" && !isCuratedBirthday
        ? birthdayNominatorIdsByCandidateId.get(candidate.id)
        : undefined,
    nominatorKeys: isCuratedBirthday
      ? (curatedEntryIdsByCandidateId.get(candidate.id) ?? []).map(
          (entryId) => `entry:${entryId}`,
        )
      : undefined,
  }));
  const nominatorRankingContext = {
    candidateSource: source,
    hostUserId: (contest.host_user_id as string | null) ?? null,
  };
  const nominatorNameByKey = isCuratedBirthday
    ? curatedEntryNameByKey
    : Object.fromEntries(memberNameByUserId);

  const nominatorFullRows =
    contest.status === "finished" && nominatorRanking
      ? computeNominatorResults(
          fullFinalCandidateRows,
          nominatorComputeCandidates,
          nominatorNameByKey,
          nominatorRankingContext,
        )
      : [];

  const nomReveal = nominatorRevealMode(
    nominatorResultsReveal,
    nominatorRankingWhen,
  );
  const nominatorMaxStep = resultsRevealMaxStep(
    nomReveal,
    nominatorFullRows.length,
    nominatorFullRows.length,
  );

  const revealBirthdayIds = birthdayIdentitiesRevealed({
    nominationKind,
    status: contest.status,
    resultsPhase,
    nominatorRanking,
    nominatorRankingWhen,
    nominatorResultsReveal,
    resultsReveal,
    resultsRevealStep,
    resultsMaxStep,
    nominatorRevealStep,
    nominatorMaxStep,
  });
  const visibleLinkedNominatorNames = revealBirthdayIds
    ? linkedNominatorNamesByCandidateId
    : {};

  const excludedOwnNominationIds = allowVoteOwnNominations
    ? []
    : votingCandidates
        .filter((candidate) => {
          if (nominationKind === "birthday") {
            return (
              birthdayNominatorIdsByCandidateId
                .get(candidate.id)
                ?.includes(user.id) === true
            );
          }
          return isExcludedOwnNomination(
            {
              nominator_user_id: candidate.nominator_user_id,
              meta: ((candidate as { meta?: Record<string, unknown> }).meta ??
                {}) as Record<string, unknown>,
            },
            user.id,
            source,
            contest.host_user_id as string,
          );
        })
        .map((candidate) => candidate.id);

  const resultBallotCount =
    resultsReveal === "by_participant" && contest.status === "finished"
      ? Math.min(Math.max(0, resultsRevealStep), eligibleOrdered.length)
      : ballots.length;
  const resultBallotTotal =
    resultsReveal === "by_participant" && contest.status === "finished"
      ? eligibleOrdered.length
      : null;

  const cookieStore = await cookies();
  const savedTab = parseContestTabId(
    cookieStore.get(contestTabCookieName(contest.id))?.value,
  );
  const savedTabAvailable =
    savedTab === "nominate"
      ? showNominateTab
      : savedTab === "host"
        ? isHost
        : savedTab != null;
  const tabFromQuery =
    results === "1"
      ? "results"
      : nominated === "1" && showNominateTab
        ? "nominate"
        : null;
  const defaultTab =
    tabFromQuery ??
    (savedTabAvailable && savedTab
      ? savedTab
      : showNominateTab && contest.nominations_open
        ? "nominate"
        : "candidates");
  const ssrTabTrusted = tabFromQuery !== null || savedTabAvailable;

  const contestUnlocked = Boolean(
    (contest as { unlocked_at?: string | null }).unlocked_at,
  );
  const showCreatedParticipantHint =
    created === "1" &&
    !contestUnlocked &&
    contest.max_members != null &&
    (contest.max_members as number) >= 1;
  const viewerPlanLimits = getPlanLimits(viewerPlanId);

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <SiteHeader
        identity={{
          userId: user.id,
          displayName: accountDisplayName,
          email: user.email ?? null,
          isAnonymous: Boolean(user.is_anonymous),
        }}
        currentPlan={viewerPlanId}
        unlockContest={
          isHost
            ? {
                id: contest.id,
                unlocked: Boolean(
                  (contest as { unlocked_at?: string | null }).unlocked_at,
                ),
              }
            : null
        }
      />
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 pb-8 pt-0">
      <ContestLiveRefresh
        contestId={contest.id}
        currentUserId={user.id}
        ejectIfRemoved
      />
      {(created === "1" ||
        nominated === "1" ||
        voting === "1" ||
        voted === "1" ||
        results === "1" ||
        revealed === "1" ||
        billing === "unlocked") && (
        <div className="space-y-1 pt-2">
          {created === "1" ? (
            <ContestCreatedBanner
              contestId={contest.id}
              maxMembers={contest.max_members as number | null}
              planId={viewerPlanId}
              planLabel={viewerPlanLimits.label}
              hasSession
              isAnonymous={Boolean(user.is_anonymous)}
              showParticipantLimitHint={showCreatedParticipantHint}
            />
          ) : null}
          {nominated === "1" ? (
            <p className="text-sm text-foreground">Candidate nominated.</p>
          ) : null}
          {voting === "1" ? (
            <p className="text-sm text-foreground">
              Voting is open. Participants can submit their ballots.
            </p>
          ) : null}
          {voted === "1" ? (
            <p className="text-sm text-foreground">Your ballot was saved.</p>
          ) : null}
          {results === "1" ? (
            <p className="text-sm text-foreground">
              Voting closed. Final results are below.
            </p>
          ) : null}
          {revealed === "1" ? (
            <p className="text-sm text-foreground">
              Candidate(s) revealed to participants.
            </p>
          ) : null}
          {billing === "unlocked" ? (
            <p className="text-sm text-foreground">
              Contest unlocked. Unlimited participants and no expiry — your
              nomination and candidate limits from setup still apply.
            </p>
          ) : null}
        </div>
      )}

      <ContestParticipantTabs
        showNominate={showNominateTab}
        showHost={isHost}
        contestId={contest.id}
        initialVotingOpen={contest.voting_open}
        initialMemberCount={members.length}
        defaultTab={defaultTab}
        ssrTabTrusted={ssrTabTrusted}
        tabStatus={{
          currentUserId: user.id,
          nominationsOpen: contest.nominations_open,
          nominateMaxCount:
            contest.candidate_source === "curated" ||
            (contest.candidate_source === "combined" &&
              isHost &&
              !canNominateUser)
              ? contest.max_candidates
              : contest.max_nominations_per_participant,
          nominateCountsAllActive:
            contest.candidate_source === "curated" ||
            (contest.candidate_source === "combined" &&
              isHost &&
              !canNominateUser),
          candidateSource: source,
          hostUserId: (contest.host_user_id as string | null) ?? null,
          deferredCandidateReveal,
          needsAdminReveal,
          isHost,
          voteSubmitted: myVoteSubmitted,
          resultsPresentation: {
            contestStatus: contest.status,
            resultsReveal,
            resultsPhase,
            resultsRevealStep,
            resultsMaxStep,
            nominatorRanking,
            nominatorRankingWhen,
            nominatorRevealStep,
            nominatorMaxStep,
          },
          candidates: candidates.map((candidate) => {
            const meta = ((candidate as { meta?: Record<string, unknown> }).meta ??
              {}) as Record<string, unknown>;
            return {
              id: candidate.id as string,
              status: candidate.status as string,
              nominator_user_id:
                (candidate.nominator_user_id as string | null) ?? null,
              nomination_origin:
                typeof meta.nomination_origin === "string"
                  ? meta.nomination_origin
                  : null,
            };
          }),
        }}
        chrome={
      <ContestPageHeader
        embedded
        contestId={contest.id}
        title={contest.title}
        joinUrl={joinUrl}
        joinCode={contest.join_code}
        defaultInviteOpen={created === "1"}
        rulesContent={
          <ContestRulesContent
            joinCode={contest.join_code}
            theme={theme}
            createdAt={contest.created_at as string}
            nominationKind={nominationKind}
            chartCountry={chartCountry}
            isCuratedBirthday={isCuratedBirthday}
            isHost={isHost}
            hostParticipates={contest.host_participates}
            source={source}
            curatedBirthdayCount={curatedBirthdayRows.length}
            maxCandidates={contest.max_candidates}
            maxNominationsPerParticipant={contest.max_nominations_per_participant}
            nominationDeadline={contest.nomination_deadline}
            nominationDurationSeconds={
              (contest as { nomination_duration_seconds?: number | null })
                .nomination_duration_seconds ?? null
            }
            allowDuplicateCandidates={contest.allow_duplicate_candidates}
            reveal={reveal}
            songLinks={songLinks}
            candidateTitle={candidateTitleLabel}
            candidateSort={candidateSort}
            scoring={scoring}
            showStarPoints={showStarPoints}
            showNominees={showNominees}
            resultsReveal={resultsReveal}
            ballotRevealOrder={ballotRevealOrder}
            resultsAnonymous={resultsAnonymous}
            nominatorRanking={nominatorRanking}
            nominatorRankingWhen={nominatorRankingWhen}
            nominatorResultsReveal={nominatorResultsReveal}
            allowVoteOwnNominations={allowVoteOwnNominations}
            voteMutability={voteMutability}
            votingCloseMode={contest.voting_close_mode as VotingCloseMode}
            votingClosesAt={contest.voting_closes_at}
            birthdayOffsetAmount={
              (contest as { birthday_offset_amount?: number })
                .birthday_offset_amount ?? 0
            }
            birthdayOffsetUnit={
              ((contest as { birthday_offset_unit?: string })
                .birthday_offset_unit === "months"
                ? "months"
                : "years") as "months" | "years"
            }
            hostPlanId={hostPlanId}
            editSettings={{
              id: contest.id,
              joinCode: contest.join_code,
              title: contest.title,
              description: contest.description,
              theme,
              candidateSource: source,
              maxNominationsPerParticipant: contest.max_nominations_per_participant,
              allowDuplicateCandidates: contest.allow_duplicate_candidates,
              hostParticipates: contest.host_participates,
              nominationDeadline: contest.nomination_deadline,
              candidateReveal: reveal,
              candidateSort,
              voteMutability,
              votingCloseMode: contest.voting_close_mode as VotingCloseMode,
              votingClosesAt: contest.voting_closes_at,
              scoringModel: scoring,
              showStarPoints,
              showNominees,
              resultsReveal,
              ballotRevealOrder,
              nominatorRanking,
              nominatorRankingWhen,
              nominatorResultsReveal,
              allowVoteOwnNominations,
              nominationsOpen: contest.nominations_open,
              status: contest.status,
              nominationKind,
              chartCountry,
              songLinks,
              candidateTitle: (contest as { candidate_title?: string | null })
                .candidate_title ?? "",
              birthdayOffsetAmount:
                (contest as { birthday_offset_amount?: number })
                  .birthday_offset_amount ?? 0,
              birthdayOffsetUnit:
                ((contest as { birthday_offset_unit?: string })
                  .birthday_offset_unit === "months"
                  ? "months"
                  : "years") as "months" | "years",
            }}
          />
        }
        initialStatus={contest.status}
        initialNominationsOpen={contest.nominations_open}
        initialVotingOpen={contest.voting_open}
        initialResultsPhase={
          (contest as { results_phase?: string | null }).results_phase ?? null
        }
        initialResultsReveal={resultsReveal}
        initialResultsRevealStep={resultsRevealStep}
        initialNominatorRevealStep={nominatorRevealStep}
        candidateSource={source}
        nominationDurationSeconds={
          (contest as { nomination_duration_seconds?: number | null })
            .nomination_duration_seconds ?? null
        }
        candidateReveal={reveal}
        initialNominationDeadline={contest.nomination_deadline}
        initialVotingClosesAt={contest.voting_closes_at}
        initialCandidates={candidates.map((candidate) => ({
          id: candidate.id as string,
          status: candidate.status as string,
        }))}
      />
        }
        nominate={
          showNominateTab ? (
            <NominateTabPanel
              contestId={contest.id}
              joinCode={contest.join_code}
              currentUserId={user.id}
              theme={theme}
              songLinks={songLinks}
              nominationsOpen={contest.nominations_open}
              nominationDeadline={contest.nomination_deadline}
              nominationDurationSeconds={
                (contest as { nomination_duration_seconds?: number | null })
                  .nomination_duration_seconds ?? null
              }
              nominationsReopenedAt={
                (contest as { nominations_reopened_at?: string | null })
                  .nominations_reopened_at ?? null
              }
              canShowNominateForm={canShowNominateForm}
              remainingNominations={remainingNominations}
              nextNominationNumber={nextNominationNumber}
              nominateMode={
                contest.candidate_source === "curated" ||
                (contest.candidate_source === "combined" &&
                  isHost &&
                  !canNominateUser)
                  ? "curated"
                  : "user"
              }
              candidateSource={source}
              hostUserId={(contest.host_user_id as string | null) ?? null}
              candidateTitleLabel={candidateTitleLabel}
              initialOwnCandidates={myCandidates
                .filter((c) => c.status !== "withdrawn" && c.status !== "rejected")
                .map((candidate) => {
                  const meta = ((candidate as { meta?: Record<string, unknown> }).meta ??
                    {}) as Record<string, unknown>;
                  return {
                    id: candidate.id,
                    title: candidate.title,
                    artist: candidate.artist,
                    url: candidate.url ?? null,
                    description: candidate.description ?? null,
                    status: candidate.status,
                    nominator_user_id: candidate.nominator_user_id,
                    nomination_origin:
                      typeof meta.nomination_origin === "string"
                        ? meta.nomination_origin
                        : null,
                    spotify_url:
                      typeof meta.spotify_url === "string" ? meta.spotify_url : null,
                    spotify_uri:
                      typeof meta.spotify_uri === "string" ? meta.spotify_uri : null,
                  };
                })}
            />
          ) : null
        }
        candidates={
          <>
      <ContestSectionCard
        id="contest-candidates"
        title={
          isCuratedBirthday && isHost
            ? "People & candidates"
            : nominationKind === "birthday" &&
                !isCuratedBirthday &&
                !isHost &&
                !candidates.some(
                  (c) => c.status === "visible" || c.status === "in_voting",
                )
              ? "Your birthday"
              : (
                  <LiveVoteSectionTitle
                    contestId={contest.id}
                    initialVotingOpen={contest.voting_open}
                    idleTitle="Candidates"
                  />
                )
        }
        description={
          isCuratedBirthday && isHost ? (
            <>
              {`${curatedBirthdayRows.length} person${
                curatedBirthdayRows.length === 1 ? "" : "s"
              } added${
                curatedBirthdayRows.some((row) => row.candidate_id)
                  ? ` · ${candidates.filter((c) => c.status !== "pending").length} chart hit${
                      candidates.filter((c) => c.status !== "pending").length === 1
                        ? ""
                        : "s"
                    } released`
                  : ""
              }`}
              {" · "}
              <LiveColoredNominationStatus
                contestId={contest.id}
                initialOpen={contest.nominations_open}
                initialNominationDeadline={contest.nomination_deadline}
                initialNominationDurationSeconds={
                  (contest as { nomination_duration_seconds?: number | null })
                    .nomination_duration_seconds ?? null
                }
                openLabel="add people until you close nominations"
                closedLabel="Nomination completed"
                notStartedLabel="Nomination not started yet"
              />
              {" · songs stay hidden from participants until you reveal"}
            </>
          ) : isCuratedBirthday && !isHost ? (
            candidates.some(
              (c) => c.status === "visible" || c.status === "in_voting",
            )
              ? `${
                  candidates.filter(
                    (c) => c.status === "visible" || c.status === "in_voting",
                  ).length
                } revealed`
              : "Songs will appear here when the host releases candidates."
          ) : nominationKind === "birthday" && !isHost ? (
            candidates.some(
              (c) => c.status === "visible" || c.status === "in_voting",
            )
              ? `${
                  candidates.filter(
                    (c) => c.status === "visible" || c.status === "in_voting",
                  ).length
                } revealed`
              : myBirthdaySubmitted
                ? "You can update your birthday until nominations close."
                : "Submit your birthday to join the chart draw."
          ) : nominationKind === "birthday" && isHost && !isCuratedBirthday ? (
            <>
              {`${candidates.length} chart hit${candidates.length === 1 ? "" : "s"} · `}
              <LiveColoredNominationStatus
                contestId={contest.id}
                initialOpen={contest.nominations_open}
                initialNominationDeadline={contest.nomination_deadline}
                initialNominationDurationSeconds={
                  (contest as { nomination_duration_seconds?: number | null })
                    .nomination_duration_seconds ?? null
                }
                closedLabel="Nomination completed"
                notStartedLabel="Nomination not started yet"
              />
              {" · songs stay hidden from participants until you reveal"}
            </>
          ) : (
            <LiveStandardCandidatesDescription
              contestId={contest.id}
              initialVotingOpen={contest.voting_open}
              initialStatus={contest.status}
              initialNominationsOpen={contest.nominations_open}
              initialNominationDeadline={contest.nomination_deadline}
              initialNominationDurationSeconds={
                (contest as { nomination_duration_seconds?: number | null })
                  .nomination_duration_seconds ?? null
              }
              initialVotingClosesAt={
                (contest as { voting_closes_at?: string | null })
                  .voting_closes_at ?? null
              }
              initialVotingReopenedAt={
                (contest as { voting_reopened_at?: string | null })
                  .voting_reopened_at ?? null
              }
              needsAdminReveal={needsAdminReveal}
              nominationsOpenLabel={
                source === "combined"
                  ? "Nominations open (curated + participants)"
                  : undefined
              }
              candidateCountFallback={`${candidates.length} ${
                source === "curated"
                  ? "added by host"
                  : source === "combined"
                    ? "candidates"
                    : "nominated"
              }`}
              initialCandidates={candidates.map((candidate) => ({
                id: candidate.id as string,
                status: candidate.status as string,
              }))}
              idleSuffix={
                candidatesErrorMessage
                  ? " · run SQL migration 013 to enable song candidates"
                  : null
              }
            />
          )
        }
        contentClassName="space-y-4"
      >
          {contest.voting_open &&
          canVoteAsParticipant &&
          isEmbeddedBallotModel(
            scoring,
            votingCandidates.filter(
              (c) => !excludedOwnNominationIds.includes(c.id as string),
            ).length,
          ) ? (
            <EmbeddedContestBallot
              contestId={contest.id}
              joinCode={contest.join_code}
              scoringModel={scoring}
              theme={theme}
              candidates={votingCandidates.map((candidate) => ({
                id: candidate.id as string,
                title: candidate.title as string,
                artist: (candidate.artist as string | null) ?? null,
                url: (candidate.url as string | null) ?? null,
                questionId:
                  ((candidate as { question_id?: string | null }).question_id as
                    | string
                    | null) ?? null,
              }))}
              excludedCandidateIds={excludedOwnNominationIds}
              myRankings={myRankings}
              myRankingsByQuestion={myRankingsByQuestion}
              contestQuestions={contestQuestions}
              voteMutability={voteMutability}
              votingClosesAt={contest.voting_closes_at ?? null}
              allowEdit
            />
          ) : null}
          <CandidatesList
            contestId={contest.id}
            joinCode={contest.join_code}
            currentUserId={user.id}
            isHost={isHost}
            theme={theme}
            nominationsOpen={contest.nominations_open}
            nominationDeadline={contest.nomination_deadline}
            nominationsReopenedAt={
              (contest as { nominations_reopened_at?: string | null })
                .nominations_reopened_at ?? null
            }
            canNominateEligible={canNominateEligible}
            candidateSort={candidateSort}
            needsAdminReveal={needsAdminReveal}
            deferredCandidateReveal={deferredCandidateReveal}
            songLinks={songLinks}
            memberNameByUserId={Object.fromEntries(memberNameByUserId)}
            canShowNominateForm={showNominateTab ? false : canShowNominateForm}
            remainingNominations={remainingNominations}
            nextNominationNumber={nextNominationNumber}
            nominateMode={
              contest.candidate_source === "curated" ||
              (contest.candidate_source === "combined" &&
                isHost &&
                !canNominateUser)
                ? "curated"
                : "user"
            }
            nominationKind={nominationKind}
            candidateSource={source}
            chartCountry={chartCountry}
            curatedBirthdayEntries={curatedBirthdayEntries}
            remainingCuratedEntries={remainingCuratedEntries}
            birthdayAlreadySubmitted={myBirthdaySubmitted}
            birthdayHadChartMatch={myBirthdayHadChartMatch}
            initialBirthday={myBirthdayRow?.birthday ?? null}
            initialShowBirthday={myBirthdayRow?.show_birthday === true}
            birthdayDateOffset={{
              amount:
                (contest as { birthday_offset_amount?: number })
                  .birthday_offset_amount ?? 0,
              unit:
                (contest as { birthday_offset_unit?: string })
                  .birthday_offset_unit === "months"
                  ? "months"
                  : "years",
            }}
            linkedNominatorNamesByCandidateId={visibleLinkedNominatorNames}
            hostCuratedLabelsByCandidateId={hostCuratedLabelsByCandidateId}
            revealBirthdayIdentities={revealBirthdayIds}
            hostUserId={contest.host_user_id as string}
            showNominees={showNominees}
            candidateTitleLabel={candidateTitleLabel}
            scoringModel={scoring}
            initialStatus={contest.status}
            initialVotingOpen={contest.voting_open}
            canRate={
              isStarRatingModel(scoring) &&
              !(isHost && contest.host_participates === false)
            }
            canPickBest={
              isBestOnlyModel(scoring) &&
              !(isHost && contest.host_participates === false)
            }
            canRankInline={
              isInlineRankChipsModel(
                scoring,
                votingCandidates.filter(
                  (c) => !excludedOwnNominationIds.includes(c.id as string),
                ).length,
              ) && !(isHost && contest.host_participates === false)
            }
            excludedCandidateIds={excludedOwnNominationIds}
            initialRatings={myRatings}
            initialRatingsSubmitted={Object.keys(myRatings).length > 0}
            initialBestPicks={myBestPicks}
            initialBestPicksSubmitted={myBestPicksSubmitted}
            initialRankingsByQuestion={
              contestQuestions.length > 0
                ? myRankingsByQuestion
                : myRankings?.length
                  ? { "": myRankings }
                  : {}
            }
            initialRankingsSubmitted={
              contestQuestions.length > 0
                ? contestQuestions.every(
                    (question) =>
                      (myRankingsByQuestion[question.id]?.length ?? 0) > 0,
                  )
                : Boolean(myRankings?.length)
            }
            voteMutability={voteMutability}
            defaultRatingQuestionId={contestQuestions[0]?.id ?? null}
            removedCandidates={removedCandidates}
            initialCandidates={candidates.map((candidate) => {
              const meta = ((candidate as { meta?: Record<string, unknown> }).meta ??
                {}) as Record<string, unknown>;
              return {
                id: candidate.id,
                title: candidate.title,
                artist: candidate.artist ?? null,
                url: candidate.url ?? null,
                description: candidate.description ?? null,
                status: candidate.status,
                nominator_user_id: candidate.nominator_user_id,
                created_at: candidate.created_at,
                display_order:
                  (candidate as { display_order?: number | null }).display_order ??
                  null,
                delete_photo_on_finish:
                  (candidate as { delete_photo_on_finish?: boolean })
                    .delete_photo_on_finish === true,
                photo_cleared:
                  typeof meta.photo_cleared_at === "string" ||
                  meta.photo_storage_deleted === true ||
                  typeof meta.storage_delete_url === "string",
                revealed_at:
                  typeof meta.revealed_at === "string" ? meta.revealed_at : null,
                spotify_url:
                  typeof meta.spotify_url === "string" ? meta.spotify_url : null,
                spotify_uri:
                  typeof meta.spotify_uri === "string" ? meta.spotify_uri : null,
                nomination_origin:
                  typeof meta.nomination_origin === "string"
                    ? meta.nomination_origin
                    : null,
                question_id:
                  ((candidate as { question_id?: string | null }).question_id as
                    | string
                    | null) ?? null,
              };
            })}
          />
      </ContestSectionCard>

          </>
        }
        results={
      <ContestPhasePanels
        panelMode="results"
        contestId={contest.id}
        joinCode={contest.join_code}
        isHost={isHost}
        hostParticipates={contest.host_participates}
        theme={theme}
        revealMode={reveal}
        candidateSort={candidateSort}
        scoringModel={scoring}
        showStarPoints={showStarPoints}
        voteMutability={voteMutability}
        votingCloseMode={
          (contest.voting_close_mode as VotingCloseMode) === "scheduled"
            ? "scheduled"
            : "manual"
        }
        votingClosesAt={contest.voting_closes_at ?? null}
        votingReopenedAt={
          (contest as { voting_reopened_at?: string | null }).voting_reopened_at ??
          null
        }
        resultsReveal={resultsReveal}
        resultsAnonymous={resultsAnonymous}
        initialResultsRevealStep={resultsRevealStep}
        resultsMaxStep={resultsMaxStep}
        nominatorRanking={nominatorRanking}
        nominatorRankingWhen={nominatorRankingWhen}
        nominatorResultsReveal={nominatorResultsReveal}
        initialResultsPhase={resultsPhase}
        initialNominatorRevealStep={nominatorRevealStep}
        nominatorMaxStep={nominatorMaxStep}
        nominatorFullRows={nominatorFullRows}
        nominatorComputeCandidates={nominatorComputeCandidates}
        nominatorNameByKey={nominatorNameByKey}
        nominatorRankingContext={nominatorRankingContext}
        excludedCandidateIds={excludedOwnNominationIds}
        initialStatus={contest.status}
        initialVotingOpen={contest.voting_open}
        initialNominationsOpen={contest.nominations_open}
        nominationDeadline={contest.nomination_deadline ?? null}
        nominationDurationSeconds={
          (contest as { nomination_duration_seconds?: number | null })
            .nomination_duration_seconds ?? null
        }
        candidateCount={candidates.length}
        pendingRevealCount={needsAdminReveal ? pendingCandidates.length : 0}
        votingCandidates={votingCandidates.map((candidate) => ({
          id: candidate.id,
          title: candidate.title,
          artist: candidate.artist,
          url: candidate.url ?? null,
          questionId:
            ((candidate as { question_id?: string | null }).question_id as
              | string
              | null) ?? null,
        }))}
        ballotCandidatesFallback={visibleCandidates.map((candidate) => ({
          id: candidate.id,
          title: candidate.title,
          artist: candidate.artist,
          url: candidate.url ?? null,
          questionId:
            ((candidate as { question_id?: string | null }).question_id as
              | string
              | null) ?? null,
        }))}
        myRankings={myRankings}
        myRankingsByQuestion={myRankingsByQuestion}
        contestQuestions={contestQuestions}
        ballotCount={resultBallotCount}
        ballotTotal={resultBallotTotal}
        fullResultRows={fullResultRows}
        fullResultRowsByQuestion={fullResultRowsByQuestion}
        resultsCandidates={votingCandidates.map((candidate) => ({
          id: candidate.id,
          title: candidate.title,
          artist: candidate.artist ?? null,
          url: candidate.url ?? null,
          questionId:
            ((candidate as { question_id?: string | null }).question_id as
              | string
              | null) ?? null,
        }))}
        resultsBallots={ballots.map((ballot) => ({
          voterUserId: ballot.voter_user_id as string,
          rankings: Array.isArray(ballot.rankings)
            ? (ballot.rankings as string[])
            : [],
          ratings: parseStarRatings((ballot as { ratings?: unknown }).ratings),
          questionId:
            ((ballot as { question_id?: string | null }).question_id as
              | string
              | null) ?? null,
        }))}
        eligibleVoters={eligibleOrdered.map((member) => ({
          userId: member.userId,
          displayName: member.displayName,
        }))}
        initialVoters={
          turnoutRows.length > 0
            ? turnoutRows.map((row) => {
                const rawCount = (row as { ballot_count?: unknown }).ballot_count;
                const ballotCount =
                  typeof rawCount === "number" && rawCount > 0 ? rawCount : 1;
                return {
                  userId: row.voter_user_id as string,
                  ballotCount,
                };
              })
            : isHost || contest.status === "finished"
              ? Object.entries(
                  ballots.reduce<Record<string, number>>((acc, ballot) => {
                    const uid = ballot.voter_user_id as string;
                    acc[uid] = (acc[uid] ?? 0) + 1;
                    return acc;
                  }, {}),
                ).map(([userId, ballotCount]) => ({ userId, ballotCount }))
              : []
        }
        members={members.map((member) => ({
          userId: member.user_id as string,
          role: member.role as string,
        }))}
        hostUserId={(contest.host_user_id as string | null) ?? null}
        showNominateTab={showNominateTab}
        hostVoteSubmitted={myVoteSubmitted}
        currentUserId={user.id}
        maxNominationsPerParticipant={contest.max_nominations_per_participant}
        resultsSubtitle={resultsSubtitle}
        resultAfterPresenters={resultAfterPresenters}
        ballotsErrorMessage={ballotsErrorMessage}
        nominationKind={nominationKind}
        candidateSource={source}
        birthdayLabelsByCandidateId={birthdayLabelsByCandidateId}
        curatedBirthdayEntries={curatedBirthdayEntries.map((entry) => ({
          id: entry.id,
          displayName: entry.displayName,
          birthday: entry.birthday,
          candidateId: entry.candidateId,
        }))}
        revealCandidates={candidates.map((candidate) => {
          const meta = ((candidate as { meta?: Record<string, unknown> }).meta ??
            {}) as Record<string, unknown>;
          return {
            id: candidate.id,
            title: candidate.title,
            artist: candidate.artist,
            url: candidate.url ?? null,
            status: candidate.status,
            created_at: candidate.created_at,
            display_order:
              (candidate as { display_order?: number | null }).display_order ??
              null,
            nominator_user_id:
              (candidate.nominator_user_id as string | null) ?? null,
            nomination_origin:
              typeof meta.nomination_origin === "string"
                ? meta.nomination_origin
                : null,
          };
        })}
        songLinks={songLinks}
        spotifyByCandidateId={Object.fromEntries(
          candidates.flatMap((candidate) => {
            const meta = ((candidate as { meta?: Record<string, unknown> }).meta ??
              {}) as Record<string, unknown>;
            if (typeof meta.spotify_url !== "string" || !meta.spotify_url) {
              return [];
            }
            return [
              [
                candidate.id,
                {
                  url: meta.spotify_url,
                  uri:
                    typeof meta.spotify_uri === "string" ? meta.spotify_uri : null,
                },
              ] as const,
            ];
          }),
        )}
        pendingPhotoDeleteCount={
          theme === "photo"
            ? candidates.filter((candidate) => {
                const meta = ((candidate as { meta?: Record<string, unknown> })
                  .meta ?? {}) as Record<string, unknown>;
                const alreadyCleared =
                  typeof meta.photo_cleared_at === "string" ||
                  meta.photo_storage_deleted === true ||
                  typeof meta.storage_delete_url === "string";
                return (
                  (candidate as { delete_photo_on_finish?: boolean })
                    .delete_photo_on_finish === true &&
                  !alreadyCleared &&
                  Boolean(candidate.url)
                );
              }).length
            : 0
        }
      />

        }
        hostArea={
          isHost ? (
            <div className="space-y-4">
              <ContestPhasePanels
                panelMode="host"
                contestId={contest.id}
                joinCode={contest.join_code}
                isHost={isHost}
                hostParticipates={contest.host_participates}
                theme={theme}
                revealMode={reveal}
                candidateSort={candidateSort}
                scoringModel={scoring}
                showStarPoints={showStarPoints}
                voteMutability={voteMutability}
                votingCloseMode={
                  (contest.voting_close_mode as VotingCloseMode) === "scheduled"
                    ? "scheduled"
                    : "manual"
                }
                votingClosesAt={contest.voting_closes_at ?? null}
                votingReopenedAt={
                  (contest as { voting_reopened_at?: string | null })
                    .voting_reopened_at ?? null
                }
                resultsReveal={resultsReveal}
                resultsAnonymous={resultsAnonymous}
                initialResultsRevealStep={resultsRevealStep}
                resultsMaxStep={resultsMaxStep}
                nominatorRanking={nominatorRanking}
                nominatorRankingWhen={nominatorRankingWhen}
                nominatorResultsReveal={nominatorResultsReveal}
                initialResultsPhase={resultsPhase}
                initialNominatorRevealStep={nominatorRevealStep}
                nominatorMaxStep={nominatorMaxStep}
                nominatorFullRows={nominatorFullRows}
                nominatorComputeCandidates={nominatorComputeCandidates}
                nominatorNameByKey={nominatorNameByKey}
                nominatorRankingContext={nominatorRankingContext}
                excludedCandidateIds={excludedOwnNominationIds}
                initialStatus={contest.status}
                initialVotingOpen={contest.voting_open}
                initialNominationsOpen={contest.nominations_open}
                nominationDeadline={contest.nomination_deadline ?? null}
                nominationDurationSeconds={
                  (contest as { nomination_duration_seconds?: number | null })
                    .nomination_duration_seconds ?? null
                }
                candidateCount={candidates.length}
                pendingRevealCount={
                  needsAdminReveal ? pendingCandidates.length : 0
                }
                votingCandidates={votingCandidates.map((candidate) => ({
                  id: candidate.id,
                  title: candidate.title,
                  artist: candidate.artist,
                  url: candidate.url ?? null,
                  questionId:
                    ((candidate as { question_id?: string | null }).question_id as
                      | string
                      | null) ?? null,
                }))}
                ballotCandidatesFallback={visibleCandidates.map((candidate) => ({
                  id: candidate.id,
                  title: candidate.title,
                  artist: candidate.artist,
                  url: candidate.url ?? null,
                  questionId:
                    ((candidate as { question_id?: string | null }).question_id as
                      | string
                      | null) ?? null,
                }))}
                myRankings={myRankings}
                myRankingsByQuestion={myRankingsByQuestion}
                contestQuestions={contestQuestions}
                ballotCount={resultBallotCount}
                ballotTotal={resultBallotTotal}
                fullResultRows={fullResultRows}
                fullResultRowsByQuestion={fullResultRowsByQuestion}
                resultsCandidates={votingCandidates.map((candidate) => ({
                  id: candidate.id,
                  title: candidate.title,
                  artist: candidate.artist ?? null,
                  url: candidate.url ?? null,
                  questionId:
                    ((candidate as { question_id?: string | null }).question_id as
                      | string
                      | null) ?? null,
                }))}
                resultsBallots={ballots.map((ballot) => ({
                  voterUserId: ballot.voter_user_id as string,
                  rankings: Array.isArray(ballot.rankings)
                    ? (ballot.rankings as string[])
                    : [],
                  ratings: parseStarRatings(
                    (ballot as { ratings?: unknown }).ratings,
                  ),
                  questionId:
                    ((ballot as { question_id?: string | null }).question_id as
                      | string
                      | null) ?? null,
                }))}
                eligibleVoters={eligibleOrdered.map((member) => ({
                  userId: member.userId,
                  displayName: member.displayName,
                }))}
                initialVoters={
                  turnoutRows.length > 0
                    ? turnoutRows.map((row) => {
                        const rawCount = (row as { ballot_count?: unknown })
                          .ballot_count;
                        const ballotCount =
                          typeof rawCount === "number" && rawCount > 0
                            ? rawCount
                            : 1;
                        return {
                          userId: row.voter_user_id as string,
                          ballotCount,
                        };
                      })
                    : isHost || contest.status === "finished"
                      ? Object.entries(
                          ballots.reduce<Record<string, number>>(
                            (acc, ballot) => {
                              const uid = ballot.voter_user_id as string;
                              acc[uid] = (acc[uid] ?? 0) + 1;
                              return acc;
                            },
                            {},
                          ),
                        ).map(([userId, ballotCount]) => ({
                          userId,
                          ballotCount,
                        }))
                      : []
                }
                members={members.map((member) => ({
                  userId: member.user_id as string,
                  role: member.role as string,
                }))}
                hostUserId={(contest.host_user_id as string | null) ?? null}
                showNominateTab={showNominateTab}
                hostVoteSubmitted={myVoteSubmitted}
                currentUserId={user.id}
                maxNominationsPerParticipant={
                  contest.max_nominations_per_participant
                }
                resultsSubtitle={resultsSubtitle}
                resultAfterPresenters={resultAfterPresenters}
                ballotsErrorMessage={ballotsErrorMessage}
                nominationKind={nominationKind}
                candidateSource={source}
                birthdayLabelsByCandidateId={birthdayLabelsByCandidateId}
                curatedBirthdayEntries={curatedBirthdayEntries.map((entry) => ({
                  id: entry.id,
                  displayName: entry.displayName,
                  birthday: entry.birthday,
                  candidateId: entry.candidateId,
                }))}
                revealCandidates={candidates.map((candidate) => {
                  const meta = ((
                    candidate as { meta?: Record<string, unknown> }
                  ).meta ?? {}) as Record<string, unknown>;
                  return {
                    id: candidate.id,
                    title: candidate.title,
                    artist: candidate.artist,
                    url: candidate.url ?? null,
                    status: candidate.status,
                    created_at: candidate.created_at,
                    display_order:
                      (candidate as { display_order?: number | null })
                        .display_order ?? null,
                    nominator_user_id:
                      (candidate.nominator_user_id as string | null) ?? null,
                    nomination_origin:
                      typeof meta.nomination_origin === "string"
                        ? meta.nomination_origin
                        : null,
                  };
                })}
                songLinks={songLinks}
                spotifyByCandidateId={Object.fromEntries(
                  candidates.flatMap((candidate) => {
                    const meta = ((
                      candidate as { meta?: Record<string, unknown> }
                    ).meta ?? {}) as Record<string, unknown>;
                    if (
                      typeof meta.spotify_url !== "string" ||
                      !meta.spotify_url
                    ) {
                      return [];
                    }
                    return [
                      [
                        candidate.id,
                        {
                          url: meta.spotify_url,
                          uri:
                            typeof meta.spotify_uri === "string"
                              ? meta.spotify_uri
                              : null,
                        },
                      ] as const,
                    ];
                  }),
                )}
                pendingPhotoDeleteCount={
                  theme === "photo"
                    ? candidates.filter((candidate) => {
                        const meta = ((
                          candidate as { meta?: Record<string, unknown> }
                        ).meta ?? {}) as Record<string, unknown>;
                        const alreadyCleared =
                          typeof meta.photo_cleared_at === "string" ||
                          meta.photo_storage_deleted === true ||
                          typeof meta.storage_delete_url === "string";
                        return (
                          (candidate as { delete_photo_on_finish?: boolean })
                            .delete_photo_on_finish === true &&
                          !alreadyCleared &&
                          Boolean(candidate.url)
                        );
                      }).length
                    : 0
                }
              />
              <CollapsibleCard
                sectionId="host-recovery-token"
                title="Host recovery token"
                description="Save this if you clear cookies. Account claim / restore comes next."
                defaultOpen={false}
              >
                <code className="block rounded-lg border bg-muted/40 px-3 py-2 text-xs break-all">
                  {contest.manage_token}
                </code>
              </CollapsibleCard>
            </div>
          ) : undefined
        }
        participants={
            <ParticipantsList
            contestId={contest.id}
            joinCode={contest.join_code}
            currentUserId={user.id}
            isHost={isHost}
            hostParticipates={contest.host_participates !== false}
            candidateSource={source}
            maxNominationsPerParticipant={
              contest.max_nominations_per_participant
            }
            initialStatus={contest.status}
            initialVotingOpen={contest.voting_open}
            initialNominationsOpen={contest.nominations_open}
            resultsReveal={resultsReveal}
            ballotRevealOrder={ballotRevealOrder}
            resultsAnonymous={resultsAnonymous}
            nominationKind={nominationKind}
            birthdaySubmittedUserIds={birthdayRows.map((row) => row.user_id)}
            initialResultsRevealStep={resultsRevealStep}
            initialVoters={
              turnoutRows.length > 0
                ? turnoutRows.map((row) => {
                    const rawCount = (row as { ballot_count?: unknown }).ballot_count;
                    const ballotCount =
                      typeof rawCount === "number" && rawCount > 0
                        ? rawCount
                        : 1;
                    return {
                      userId: row.voter_user_id as string,
                      updatedAt:
                        (row.updated_at as string | null) ??
                        (row.submitted_at as string | null) ??
                        null,
                      ballotCount,
                    };
                  })
                : isHost || contest.status === "finished"
                  ? (() => {
                      const byUser = new Map<
                        string,
                        { updatedAt: string | null; ballotCount: number }
                      >();
                      for (const ballot of ballots) {
                        const userId = ballot.voter_user_id as string;
                        const updatedAt =
                          (ballot.updated_at as string | null) ??
                          (ballot.submitted_at as string | null) ??
                          null;
                        const prev = byUser.get(userId);
                        byUser.set(userId, {
                          updatedAt: updatedAt ?? prev?.updatedAt ?? null,
                          ballotCount: (prev?.ballotCount ?? 0) + 1,
                        });
                      }
                      return [...byUser.entries()].map(([userId, entry]) => ({
                        userId,
                        updatedAt: entry.updatedAt,
                        ballotCount: entry.ballotCount,
                      }));
                    })()
                  : []
            }
            questionCount={Math.max(1, contestQuestions.length)}
            members={members.map((member) => ({
              id: member.id,
              userId: member.user_id,
              displayName: member.display_name,
              role: member.role,
              joinedAt: member.joined_at,
            }))}
            removedMembers={removedMembers}
            initialCandidates={candidates.map((candidate) => ({
              id: candidate.id,
              nominator_user_id: candidate.nominator_user_id,
              status: candidate.status,
              meta: ((candidate as { meta?: Record<string, unknown> }).meta ??
                null) as Record<string, unknown> | null,
            }))}
          />
        }
      />

      {contest.description ? (
        <p className="text-sm text-muted-foreground">{contest.description}</p>
      ) : null}

    </main>
    </div>
  );
}
