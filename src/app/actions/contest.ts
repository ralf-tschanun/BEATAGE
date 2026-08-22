"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ensureAnonymousSession } from "@/lib/supabase/auth";
import {
  resolveAccountDisplayName,
  shouldRepairHostPollutedProfile,
} from "@/lib/account-display-name";
import { normalizePreviewUrl } from "@/lib/music";
import { parseChartCountry } from "@/lib/charts";
import {
  applyBirthdayOffset,
  parseBirthdayOffsetAmount,
  parseBirthdayOffsetUnit,
} from "@/lib/birthday-offset";
import { uploadContestPhoto, flushPendingContestPhotoDeletes } from "@/lib/contest-photos";
import { findSpotifyTrack } from "@/lib/spotify";
import {
  allowsNominatorRanking,
  clampNominationsForPlan,
  isStarRatingModel,
  parseSongLinksMode,
  parseStarRatings,
  type CandidateSource,
  type PlanId,
} from "@/lib/plans";
import { effectiveContestTitle, effectiveTopicName, normalizeCandidateTitleInput } from "@/lib/create-wizard";
import { activeContestLimitMessage } from "@/lib/contest-unlock";
import { clampNominationDurationSeconds } from "@/lib/nomination-duration";

export type ContestActionState = {
  error?: string;
  success?: boolean;
  message?: string;
  /** Unlock-at-create: client navigates here after the pending contest exists. */
  checkoutUrl?: string;
  /** Create success: client navigates (dialog-driven server redirect is unreliable). */
  redirectTo?: string;
} | null;

type RpcClient = Awaited<ReturnType<typeof ensureAnonymousSession>>["supabase"];

/** Best-effort: resolve Spotify track and store URL on the candidate. Never throws. */
async function attachSpotifyLinkBestEffort(
  supabase: RpcClient,
  candidateId: string | null | undefined,
  title: string,
  artist: string,
): Promise<boolean> {
  if (!candidateId || !title.trim() || !artist.trim()) return false;
  try {
    const match = await findSpotifyTrack(title, artist);
    if (!match) return false;
    const { error } = await supabase.rpc("attach_candidate_spotify", {
      p_candidate_id: candidateId,
      p_spotify_url: match.url,
      p_spotify_id: match.id,
      p_spotify_uri: match.uri,
    });
    return !error;
  } catch {
    // Spotify is optional — nomination should still succeed.
    return false;
  }
}

function mapRpcError(
  message: string,
  planId: PlanId = "free",
  options?: { requiresContestUnlock?: boolean },
): string {
  if (message.includes("ACTIVE_CONTEST_LIMIT")) {
    // Unlock-at-create bypasses plan slots in SQL; if we still hit this, the DB
    // patch is missing — do not show the normal "finish a contest" copy.
    if (options?.requiresContestUnlock) {
      return "Unlock create needs a database update. Please run SQL migration 071 in Supabase, then try again.";
    }
    return activeContestLimitMessage(planId);
  }
  if (message.includes("CONTEST_FULL")) {
    return "This contest is full (participant limit reached).";
  }
  if (message.includes("CONTEST_EXPIRED")) {
    return "This contest has expired due to inactivity.";
  }
  if (message.includes("CONTEST_NOT_FOUND")) {
    return "Contest not found. Check the invite code.";
  }
  if (message.includes("CONTEST_NOT_JOINABLE")) {
    return "This contest is not open for joining.";
  }
  if (message.includes("TITLE_REQUIRED") || message.includes("HOST_NAME_REQUIRED")) {
    return "Please fill in all required fields.";
  }
  if (message.includes("DISPLAY_NAME_REQUIRED")) {
    return "Please enter your name.";
  }
  if (message.includes("NOT_HOST")) {
    return "Only the host can do that.";
  }
  if (message.includes("HOST_CANNOT_LEAVE")) {
    return "Hosts cannot leave. Delete the contest instead.";
  }
  if (message.includes("CANNOT_REMOVE_HOST")) {
    return "The host cannot be removed.";
  }
  if (message.includes("MEMBER_NOT_FOUND")) {
    return "That participant was not found.";
  }
  if (message.includes("NOT_A_MEMBER")) {
    return "You are not a member of this contest.";
  }
  if (message.includes("INVALID_SETTINGS")) {
    return "Please check the contest settings.";
  }
  if (message.includes("VOTING_CLOSE_REQUIRED")) {
    return "Please set a voting end time.";
  }
  if (message.includes("NOMINATIONS_CANNOT_REOPEN")) {
    return "Nominations can only be reopened before voting has started.";
  }
  if (message.includes("VOTING_IN_PROGRESS")) {
    return "Close voting before reopening nominations.";
  }
  if (message.includes("VOTING_NOT_FINISHED")) {
    return "Voting is still open — use close voting instead.";
  }
  if (message.includes("PRESENTATION_COMPLETE")) {
    return "The results presentation is finished — voting cannot be reopened.";
  }
  if (message.includes("PRESENTATION_STARTED")) {
    return "Results presentation has started — voting cannot be reopened.";
  }
  if (message.includes("NOMINATIONS_CLOSED") || message.includes("NOMINATION_DEADLINE")) {
    return "Nominations are closed for this contest.";
  }
  if (message.includes("NOMINATIONS_NOT_ALLOWED")) {
    return "Participants cannot nominate in this contest type.";
  }
  if (message.includes("CURATED_HOST_ONLY")) {
    return "Only the host can add candidates in a curated contest.";
  }
  if (message.includes("CANDIDATE_LIMIT")) {
    return "This contest has reached its candidate limit.";
  }
  if (message.includes("NOMINATION_LIMIT")) {
    return "You already used all your nominations.";
  }
  if (message.includes("DUPLICATE_CANDIDATE")) {
    return "This candidate was already nominated.";
  }
  if (message.includes("HOST_NOT_PARTICIPATING")) {
    return "The host is admin-only in this contest and cannot take part.";
  }
  if (message.includes("ARTIST_REQUIRED")) {
    return "Please enter the artist name.";
  }
  if (message.includes("CANDIDATE_NOT_FOUND")) {
    return "Candidate not found.";
  }
  if (message.includes("CANDIDATE_WITHDRAWN")) {
    return "This nomination was already removed.";
  }
  if (message.includes("NOT_OWNER")) {
    return "You can only edit your own nominations.";
  }
  if (message.includes("CONTEST_LOCKED")) {
    return "Finished or expired contests cannot be edited.";
  }
  if (message.includes("NO_CANDIDATES")) {
    return "Add at least one candidate before starting voting.";
  }
  if (message.includes("VOTING_NOT_OPEN") || message.includes("VOTING_NOT_ALLOWED")) {
    return "Voting is not open for this contest.";
  }
  if (message.includes("INVALID_BALLOT")) {
    return "Please rank the required number of distinct candidates.";
  }
  if (message.includes("INVALID_RATINGS")) {
    return "Please rate each candidate with 0–5 stars.";
  }
  if (message.includes("BALLOT_LOCKED")) {
    return "Your ballot is locked and cannot be changed.";
  }
  if (message.includes("CANDIDATES_NOT_REVEALED")) {
    return "Reveal all candidates before starting voting.";
  }
  if (message.includes("NO_PENDING_CANDIDATES")) {
    return "There are no pending candidates left to reveal.";
  }
  if (message.includes("REVEAL_NOT_REQUIRED")) {
    return "This contest does not use admin candidate reveal.";
  }
  if (message.includes("VOTING_ALREADY_OPEN")) {
    return "Candidates can no longer be revealed after voting has started.";
  }
  if (message.includes("RESULTS_NOT_READY")) {
    return "Results can only be revealed after voting has ended.";
  }
  if (message.includes("RESULTS_ALREADY_COMPLETE")) {
    return "All results are already revealed.";
  }
  if (message.includes("NOMINATIONS_CLOSED")) {
    return "Nominations are already closed for this contest.";
  }
  if (message.includes("NOT_BIRTHDAY_CONTEST")) {
    return "This contest is not in birthday nomination mode.";
  }
  if (message.includes("NOT_CURATED_BIRTHDAY")) {
    return "This contest is not in curated birthday mode.";
  }
  if (message.includes("ENTRY_NOT_FOUND")) {
    return "That entry was not found.";
  }
  if (message.includes("ENTRY_ALREADY_REVEALED")) {
    return "That entry was already released and cannot be removed.";
  }
  if (message.includes("CANDIDATE_LIMIT")) {
    return "The candidate limit for this contest has been reached.";
  }
  if (message.includes("ALREADY_NOMINATED")) {
    return "You already submitted a birthday for this contest.";
  }
  if (message.includes("HOST_ADMIN_ONLY")) {
    return "The host is admin-only and cannot nominate in this contest.";
  }
  if (message.includes("OWN_NOMINATION_NOT_ALLOWED")) {
    return "You cannot rank your own nominations in this contest.";
  }
  if (message.includes("NO_ELIGIBLE_CANDIDATES")) {
    return "There are not enough candidates left to vote on (own nominations are excluded).";
  }
  return message || "Something went wrong.";
}

function isNextRedirect(error: unknown): boolean {
  return (
    typeof error === "object" &&
    !!error &&
    "digest" in error &&
    String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

type WizardSeedPayload = {
  questions?: Array<{ id: string; name: string }>;
  draftAnything?: Array<{
    id?: string;
    title: string;
    url: string;
    description: string;
  }>;
  anythingSharedCandidates?: boolean;
  draftAnythingByQuestion?: Record<
    string,
    Array<{ id?: string; title: string; url: string; description: string }>
  >;
  draftSongs?: Array<{ title: string; artist: string; previewUrl: string }>;
  draftBirthdayEntries?: Array<{ displayName: string; birthday: string }>;
  maxCuratedCandidates?: number | null;
  seedCurated?: boolean;
  photoCount?: number;
  /** When true, reveal candidates and open voting right after create. */
  quickPoll?: boolean;
  /** Curated contests: same as quickPoll, from the create-wizard switch. */
  startVotingImmediately?: boolean;
};

type AnythingSeedItem = {
  id?: string;
  title: string;
  url: string;
  description: string;
};

function anythingSeedUsesSharedList(seed: WizardSeedPayload): boolean {
  const sharedDraft = (seed.draftAnything ?? []).filter((item) => item.title.trim());
  const byQuestion = seed.draftAnythingByQuestion ?? {};
  const byQuestionFilled = Object.values(byQuestion).some((list) =>
    list.some((item) => item.title.trim()),
  );
  return seed.anythingSharedCandidates !== false || (sharedDraft.length > 0 && !byQuestionFilled);
}

function anythingItemsForQuestion(
  seed: WizardSeedPayload,
  questionWizardId: string,
): AnythingSeedItem[] {
  if (anythingSeedUsesSharedList(seed)) {
    return seed.draftAnything ?? [];
  }
  return seed.draftAnythingByQuestion?.[questionWizardId] ?? [];
}

function parseQuestionIdsFromSeed(data: unknown): string[] {
  if (!data || typeof data !== "object" || !("question_ids" in data)) {
    return [];
  }
  const raw = (data as { question_ids?: unknown }).question_ids;
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string");
}

function parseWizardSeedPayload(formData: FormData): WizardSeedPayload {
  const raw = String(formData.get("wizardSeed") ?? "").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as WizardSeedPayload;
  } catch {
    return {};
  }
}

async function seedWizardDataAfterCreate(
  supabase: RpcClient,
  contestId: string,
  theme: string,
  formData: FormData,
  seed: WizardSeedPayload,
): Promise<string | null> {
  const maxCurated =
    typeof seed.maxCuratedCandidates === "number" && seed.maxCuratedCandidates > 0
      ? seed.maxCuratedCandidates
      : null;

  // Song/photo/birthday: set cap before nominate. Anything sets it inside its seed block
  // (shared candidates are duplicated per question).
  if (seed.seedCurated && maxCurated != null && theme !== "generic") {
    const { error: capError } = await supabase
      .from("contests")
      .update({ max_candidates: maxCurated })
      .eq("id", contestId);
    if (capError) {
      return mapRpcError(capError.message);
    }
  }

  const questions = seed.questions ?? [];
  let dbQuestionIds: string[] = [];

  if (theme === "generic" || theme === "song" || theme === "photo") {
    const topicPayload = questions.map((q) => ({
      name: effectiveTopicName(q.name),
    }));
    if (topicPayload.length > 0) {
      const { data: seedQuestionsData, error: seedError } = await supabase.rpc(
        "seed_contest_questions",
        {
          p_contest_id: contestId,
          p_questions: topicPayload,
        },
      );
      if (seedError) {
        return mapRpcError(seedError.message);
      }
      dbQuestionIds = parseQuestionIdsFromSeed(seedQuestionsData);
    }
  }

  if (theme === "generic" && seed.seedCurated) {
    const wizardToDb = new Map<string, string>();
    questions.forEach((question, index) => {
      const dbId = dbQuestionIds[index];
      if (dbId) wizardToDb.set(question.id, dbId);
    });

    const sharedDraft = (seed.draftAnything ?? []).filter((item) =>
      item.title.trim(),
    );
    const shared = anythingSeedUsesSharedList(seed);

    const anythingLabels: Array<{
      questionId: string;
      label: string;
      labelMode: string;
    }> = [];

    // Shared: one candidate row for all questions. Per-question: one pool each.
    const nominatePlan: Array<{
      questionDbId: string | null;
      item: AnythingSeedItem;
    }> = [];

    if (shared) {
      for (const item of sharedDraft) {
        nominatePlan.push({ questionDbId: null, item });
      }
    } else {
      for (const question of questions) {
        const dbQuestionId = wizardToDb.get(question.id);
        if (!dbQuestionId) continue;
        for (const item of anythingItemsForQuestion(seed, question.id)) {
          if (!item.title.trim()) continue;
          nominatePlan.push({ questionDbId: dbQuestionId, item });
        }
      }
    }

    if (nominatePlan.length > 0) {
      const { error: capError } = await supabase
        .from("contests")
        .update({ max_candidates: nominatePlan.length })
        .eq("id", contestId);
      if (capError) {
        return mapRpcError(capError.message);
      }
    }

    for (const entry of nominatePlan) {
      const title = entry.item.title.trim();
      let url = entry.item.url.trim();
      const description = entry.item.description.trim();
      const fileId = entry.item.id?.trim();
      if (fileId) {
        const file = formData.get(`anythingFile_${fileId}`);
        if (file instanceof File && file.size > 0) {
          const uploaded = await uploadContestPhoto(supabase, contestId, file);
          if ("error" in uploaded) {
            return uploaded.error;
          }
          url = uploaded.url;
        }
      }
      const { error } = await supabase.rpc("nominate_candidate", {
        p_contest_id: contestId,
        p_title: title,
        p_url: url || null,
        p_description: description || null,
        p_artist: null,
        p_delete_photo_on_finish: false,
        p_question_id: entry.questionDbId,
        p_as_curated: true,
      });
      if (error) {
        return mapRpcError(error.message);
      }
    }

    // Labels stay per question for later Anything UI (shared titles repeated).
    for (const question of questions) {
      const dbQuestionId = wizardToDb.get(question.id);
      if (!dbQuestionId) continue;
      for (const item of anythingItemsForQuestion(seed, question.id)) {
        const label = item.title.trim();
        if (!label) continue;
        anythingLabels.push({
          questionId: dbQuestionId,
          label,
          labelMode: "custom",
        });
      }
    }

    if (anythingLabels.length > 0) {
      const { error: labelError } = await supabase.rpc("seed_anything_candidates", {
        p_contest_id: contestId,
        p_candidates: anythingLabels,
      });
      if (labelError) {
        return mapRpcError(labelError.message);
      }
    }
  }

  if (theme === "song" && seed.seedCurated) {
    for (const song of seed.draftSongs ?? []) {
      const title = song.title.trim();
      const artist = song.artist.trim();
      if (!title || !artist) continue;
      const previewUrl = normalizePreviewUrl(song.previewUrl) ?? "";
      const { data, error } = await supabase.rpc("nominate_candidate", {
        p_contest_id: contestId,
        p_title: title,
        p_url: previewUrl || null,
        p_description: null,
        p_artist: artist,
        p_delete_photo_on_finish: false,
        p_as_curated: true,
      });
      if (error) {
        return mapRpcError(error.message);
      }
      const candidateId =
        data &&
        typeof data === "object" &&
        "id" in data &&
        typeof (data as { id?: unknown }).id === "string"
          ? (data as { id: string }).id
          : null;
      await attachSpotifyLinkBestEffort(supabase, candidateId, title, artist);
    }
  }

  if (theme === "photo" && seed.seedCurated) {
    const photoCount = seed.photoCount ?? 0;
    for (let index = 0; index < photoCount; index++) {
      const photo = formData.get(`photoFile_${index}`);
      if (!(photo instanceof File) || photo.size <= 0) {
        return "Please re-select all curated photos before creating.";
      }
      const uploaded = await uploadContestPhoto(supabase, contestId, photo);
      if ("error" in uploaded) {
        return uploaded.error;
      }
      const title =
        String(formData.get(`photoTitle_${index}`) ?? "").trim() ||
        photo.name.replace(/\.[^.]+$/, "").trim() ||
        "Photo";
      const { error } = await supabase.rpc("nominate_candidate", {
        p_contest_id: contestId,
        p_title: title,
        p_url: uploaded.url,
        p_description: null,
        p_artist: null,
        p_delete_photo_on_finish: false,
        p_as_curated: true,
      });
      if (error) {
        return mapRpcError(error.message);
      }
    }
  }

  for (const entry of seed.draftBirthdayEntries ?? []) {
    const displayName = entry.displayName.trim();
    const birthday = entry.birthday.trim();
    if (!displayName || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) continue;
    const { error } = await supabase.rpc("add_curated_birthday_entry", {
      p_contest_id: contestId,
      p_display_name: displayName,
      p_birthday: birthday,
      p_show_in_results: false,
    });
    if (error) {
      return mapRpcError(error.message);
    }
  }

  return null;
}

export async function createContestAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const title = effectiveContestTitle(String(formData.get("title") ?? ""));
  const hostNameFromForm = String(formData.get("hostName") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  const theme = String(formData.get("theme") ?? "generic");
  const candidateSource = String(
    formData.get("candidateSource") ?? "user_single",
  ) as CandidateSource;
  const planId = String(formData.get("planId") ?? "free") as PlanId;
  const requiresContestUnlock =
    String(formData.get("requiresContestUnlock") ?? "false") === "true";
  const maxNomsRaw = Number(formData.get("maxNominationsPerParticipant") ?? 1);
  const clampedNoms = requiresContestUnlock
    ? Math.max(1, maxNomsRaw)
    : clampNominationsForPlan(planId, maxNomsRaw, candidateSource);
  const maxCuratedRaw = Number(formData.get("maxCuratedCandidates") ?? 0);

  const nominationCloseMode = String(
    formData.get("nominationCloseMode") ?? "manual",
  );
  const nominationDeadline =
    nominationCloseMode === "scheduled"
      ? String(formData.get("nominationClosesAt") ?? "").trim()
      : "";
  const nominationDurationRaw = Number(
    formData.get("nominationDurationSeconds") ?? 0,
  );
  const nominationDurationSeconds =
    nominationCloseMode === "duration"
      ? clampNominationDurationSeconds(nominationDurationRaw)
      : null;

  let nominatorRanking =
    String(formData.get("nominatorRanking") ?? "true") === "true";
  const resultsAnonymous =
    String(formData.get("resultsAnonymous") ?? "false") === "true";
  const nominationKind =
    String(formData.get("nominationKind") ?? "standard") === "birthday"
      ? ("birthday" as const)
      : ("standard" as const);
  if (
    resultsAnonymous ||
    !allowsNominatorRanking(candidateSource, nominationKind)
  ) {
    nominatorRanking = false;
  }

  const settings = {
    theme,
    candidate_source: candidateSource,
    max_nominations_per_participant: clampedNoms,
    requires_contest_unlock: requiresContestUnlock,
    max_curated_candidates:
      requiresContestUnlock && maxCuratedRaw > 0 ? maxCuratedRaw : null,
    allow_duplicate_candidates:
      String(formData.get("allowDuplicateCandidates") ?? "false") === "true",
    host_participates: String(formData.get("hostParticipates") ?? "true") === "true",
    nomination_deadline: nominationDeadline,
    candidate_reveal: String(formData.get("candidateReveal") ?? "live"),
    candidate_sort: String(formData.get("candidateSort") ?? "as_entered"),
    voting_access: "after_release",
    vote_mutability: String(
      formData.get("voteMutability") ?? "editable_until_close",
    ),
    voting_close_mode: "manual",
    voting_closes_at: "",
    scoring_model: String(formData.get("scoringModel") ?? "linear_x"),
    results_reveal: String(formData.get("resultsReveal") ?? "immediate"),
    ballot_reveal_order: String(
      formData.get("ballotRevealOrder") ?? "alphabetical",
    ),
    nomination_kind: nominationKind,
    chart_country: parseChartCountry(String(formData.get("chartCountry") ?? "US")),
    nominator_ranking: nominatorRanking,
    nominator_ranking_when: String(formData.get("nominatorRankingWhen") ?? "after"),
    nominator_results_reveal: String(
      formData.get("nominatorResultsReveal") ?? "immediate",
    ),
    allow_vote_own_nominations:
      String(formData.get("allowVoteOwnNominations") ?? "false") === "true",
    results_anonymous: resultsAnonymous,
  };

  const wizardSeed = parseWizardSeedPayload(formData);

  try {
    const { supabase, user } = await ensureAnonymousSession();

    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();

    const accountName =
      resolveAccountDisplayName(user, profile?.display_name) ||
      (!user.is_anonymous ? user.email?.split("@")[0]?.trim() || "" : "");

    // Contest nickname is optional; signed-in users fall back to account name,
    // guests without a name appear as "Host".
    const hostName =
      hostNameFromForm || accountName || (user.is_anonymous ? "Host" : "");
    if (!hostName) {
      return { error: "Please fill in all required fields." };
    }

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
    }

    const { data, error } = await supabase.rpc("create_contest", {
      p_title: title,
      p_host_name: hostName,
      p_description: description || null,
      p_settings: settings,
    });

    if (error) {
      return {
        error: mapRpcError(error.message, planId, {
          requiresContestUnlock,
        }),
      };
    }

    const result = data as { id?: string; join_code: string };
    const contestId = typeof result.id === "string" ? result.id : null;
    if (!contestId) {
      return { error: "Contest was created but the id was missing." };
    }

    // Ensure unlock drafts stay hidden until Polar confirms (even if create_contest
    // was not yet patched to write payment_pending itself).
    // Keep host nomination/candidate limits from settings — unlock only lifts
    // plan participant caps and expiry.
    if (requiresContestUnlock) {
      const { error: pendingError } = await supabase
        .from("contests")
        .update({
          status: "payment_pending",
          max_members: null,
          expires_at: null,
        })
        .eq("id", contestId);
      if (pendingError) {
        return {
          error: pendingError.message.includes("payment_pending")
            ? "Unlock create needs SQL migration 070 (payment_pending). Please run it in Supabase."
            : mapRpcError(pendingError.message, planId),
        };
      }
    }

    if (settings.nomination_kind === "birthday") {
      const offsetAmount = parseBirthdayOffsetAmount(
        formData.get("birthdayOffsetAmount"),
      );
      const offsetUnit = parseBirthdayOffsetUnit(
        formData.get("birthdayOffsetUnit"),
      );
      const { error: offsetError } = await supabase
        .from("contests")
        .update({
          birthday_offset_amount: offsetAmount,
          birthday_offset_unit: offsetUnit,
        })
        .eq("id", contestId);
      if (offsetError) {
        return { error: mapRpcError(offsetError.message) };
      }
    }

    if (settings.theme === "song") {
      const songLinks = String(formData.get("songLinks") ?? "preview").trim();
      const mode =
        songLinks === "spotify" || songLinks === "none" || songLinks === "preview"
          ? songLinks
          : "preview";
      const { error: songLinksError } = await supabase
        .from("contests")
        .update({ song_links: mode })
        .eq("id", contestId);
      if (songLinksError) {
        return { error: mapRpcError(songLinksError.message) };
      }
    }

    if (resultsAnonymous) {
      const { error: anonError } = await supabase
        .from("contests")
        .update({ results_anonymous: true })
        .eq("id", contestId);
      if (anonError && !anonError.message.includes("results_anonymous")) {
        return { error: mapRpcError(anonError.message) };
      }
    }

    const candidateTitle = normalizeCandidateTitleInput(
      String(formData.get("candidateTitle") ?? ""),
    );
    const { error: candidateTitleError } = await supabase
      .from("contests")
      .update({ candidate_title: candidateTitle })
      .eq("id", contestId);
    if (
      candidateTitleError &&
      !candidateTitleError.message.includes("candidate_title")
    ) {
      return { error: mapRpcError(candidateTitleError.message) };
    }

    const showStarPoints =
      isStarRatingModel(settings.scoring_model) &&
      String(formData.get("showStarPoints") ?? "false") === "true";
    const { error: starPointsError } = await supabase
      .from("contests")
      .update({ show_star_points: showStarPoints })
      .eq("id", contestId);
    if (
      starPointsError &&
      !starPointsError.message.includes("show_star_points")
    ) {
      return { error: mapRpcError(starPointsError.message) };
    }

    const hasParticipantNominations =
      settings.candidate_source === "user_single" ||
      settings.candidate_source === "user_multiple" ||
      settings.candidate_source === "combined";
    if (hasParticipantNominations && settings.nomination_kind !== "birthday") {
      const showNominees =
        String(formData.get("showNominees") ?? "false") === "true";
      const { error: showNomineesError } = await supabase
        .from("contests")
        .update({ show_nominees: showNominees })
        .eq("id", contestId);
      if (
        showNomineesError &&
        !showNomineesError.message.includes("show_nominees")
      ) {
        return { error: mapRpcError(showNomineesError.message) };
      }
    }

    if (nominationDurationSeconds != null) {
      const { error: durationError } = await supabase
        .from("contests")
        .update({
          nomination_duration_seconds: nominationDurationSeconds,
          nominations_open: false,
          nomination_deadline: null,
        })
        .eq("id", contestId);
      if (durationError) {
        return {
          error: durationError.message.includes("nomination_duration_seconds")
            ? "Timed nomination windows need SQL migration 065. Please run it in Supabase."
            : mapRpcError(durationError.message),
        };
      }
    }

    // Unlock: create payment_pending contest, then hand checkout URL to the client.
    // Server redirect from a dialog-driven action is unreliable; client navigation is.
    if (requiresContestUnlock) {
      // nominate_candidate only allows status open/voting — briefly open to seed,
      // then restore payment_pending until Polar confirms.
      const { error: seedOpenError } = await supabase
        .from("contests")
        .update({ status: "open", nominations_open: true })
        .eq("id", contestId);
      if (seedOpenError) {
        return { error: mapRpcError(seedOpenError.message, planId) };
      }

      const seedError = await seedWizardDataAfterCreate(
        supabase,
        contestId,
        settings.theme,
        formData,
        wizardSeed,
      );

      const curatedClosed =
        settings.candidate_source === "curated" &&
        settings.nomination_kind !== "birthday";

      const { error: restorePendingError } = await supabase
        .from("contests")
        .update({
          status: "payment_pending",
          // Curated lists are already seeded — keep closed like a normal create.
          nominations_open: curatedClosed ? false : true,
        })
        .eq("id", contestId);
      if (restorePendingError) {
        return {
          error: restorePendingError.message.includes("payment_pending")
            ? "Unlock create needs SQL migration 070 (payment_pending). Please run it in Supabase."
            : mapRpcError(restorePendingError.message, planId),
        };
      }

      if (seedError) {
        return { error: seedError };
      }

      const unlockStartImmediately =
        wizardSeed.quickPoll === true || wizardSeed.startVotingImmediately === true;
      const unlockTimedNoms =
        nominationCloseMode === "scheduled" || nominationCloseMode === "duration";
      if (unlockStartImmediately && unlockTimedNoms) {
        await supabase
          .from("contests")
          .update({ auto_start_voting: true })
          .eq("id", contestId);
      }
      const checkoutPath = `/api/billing/checkout?sku=contest_unlock&contestId=${encodeURIComponent(contestId)}`;
      // Guests must create an email account before Polar; keep ownership via
      // in-place guest conversion on /billing/account.
      const checkoutUrl = user.is_anonymous
        ? `/billing/account?next=${encodeURIComponent(checkoutPath)}`
        : checkoutPath;
      return {
        success: true,
        checkoutUrl,
      };
    }

    const seedError = await seedWizardDataAfterCreate(
      supabase,
      contestId,
      settings.theme,
      formData,
      wizardSeed,
    );
    // Contest row already exists — always hand the host to the contest page.
    // (Dialog-triggered server redirect is unreliable; client follows redirectTo.)
    if (seedError) {
      return {
        success: true,
        redirectTo: `/c/${result.join_code}?created=1`,
        message: seedError,
      };
    }

    // Curated lists are seeded at create — do not leave a participant nomination
    // window open (Host would see “Close nominations” with nothing to collect).
    // Host can reopen from Host Area to add more curated entries if needed.
    if (
      settings.candidate_source === "curated" &&
      settings.nomination_kind !== "birthday"
    ) {
      await supabase
        .from("contests")
        .update({ nominations_open: false })
        .eq("id", contestId);
    }

    const startVotingImmediately =
      wizardSeed.quickPoll === true || wizardSeed.startVotingImmediately === true;
    const timedNominationClose =
      nominationCloseMode === "scheduled" || nominationCloseMode === "duration";

    // Timed noms: store flag so maybe_auto_close_nominations / close_nominations
    // can open voting when the nomination window ends.
    if (startVotingImmediately && timedNominationClose) {
      const { error: autoStartError } = await supabase
        .from("contests")
        .update({ auto_start_voting: true })
        .eq("id", contestId);
      if (
        autoStartError &&
        !autoStartError.message.includes("auto_start_voting")
      ) {
        return {
          success: true,
          redirectTo: `/c/${result.join_code}?created=1`,
          message: mapRpcError(autoStartError.message),
        };
      }
      // Missing column: still open the contest; host can start voting manually.
    }

    // Curated + no timed nomination window: open voting on create.
    if (
      settings.candidate_source === "curated" &&
      startVotingImmediately &&
      !timedNominationClose
    ) {
      // Best-effort reveal (live contests may already be visible), then open voting.
      await supabase.rpc("reveal_all_candidates", {
        p_contest_id: contestId,
      });

      const { error: votingError } = await supabase.rpc("start_voting", {
        p_contest_id: contestId,
      });
      if (votingError) {
        return {
          success: true,
          redirectTo: `/c/${result.join_code}?created=1`,
          message: mapRpcError(votingError.message),
        };
      }

      return {
        success: true,
        redirectTo: `/c/${result.join_code}?created=1&voting=1`,
      };
    }

    return {
      success: true,
      redirectTo: `/c/${result.join_code}?created=1`,
    };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function joinContestAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const joinCode = String(formData.get("joinCode") ?? "")
    .trim()
    .toUpperCase();
  const displayName = String(formData.get("displayName") ?? "").trim();

  if (!joinCode || !displayName) {
    return { error: "Please fill in all required fields." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();
    const { data, error } = await supabase.rpc("join_contest", {
      p_join_code: joinCode,
      p_display_name: displayName,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    const result = data as { join_code: string };
    redirect(`/c/${result.join_code}`);
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function deleteContestAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const contestId = String(formData.get("contestId") ?? "").trim();

  if (!contestId) {
    return { error: "Missing contest id." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();
    const { error } = await supabase.rpc("delete_contest", {
      p_contest_id: contestId,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    const stayOnPage = String(formData.get("stayOnPage") ?? "") === "1";
    revalidatePath("/");
    if (stayOnPage) {
      return { success: true };
    }

    redirect("/?deleted=1");
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

/**
 * Host-only: create a fresh contest with the same settings and candidates
 * (no members, votes, or results). Ideal for rematches like “Player of the match”.
 */
export async function cloneContestAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const sourceContestId = String(formData.get("contestId") ?? "").trim();
  if (!sourceContestId) {
    return { error: "Missing contest id." };
  }

  try {
    const { supabase, user } = await ensureAnonymousSession();

    const { data: source, error: sourceError } = await supabase
      .from("contests")
      .select(
        `
        id, title, description, host_user_id, candidate_source, max_nominations_per_participant,
        max_candidates, allow_duplicate_candidates, candidate_reveal, candidate_sort,
        vote_mutability, scoring_model, host_participates, theme, results_reveal,
        ballot_reveal_order, nominator_ranking, nominator_ranking_when, nominator_results_reveal,
        allow_vote_own_nominations, nomination_kind, chart_country, birthday_offset_amount,
        birthday_offset_unit, song_links, results_anonymous, candidate_title, show_star_points,
        show_nominees, nomination_duration_seconds, unlocked_at, auto_start_voting
      `,
      )
      .eq("id", sourceContestId)
      .maybeSingle();

    if (sourceError) {
      return { error: mapRpcError(sourceError.message) };
    }
    if (!source || source.host_user_id !== user.id) {
      return { error: "Only the host can clone this contest." };
    }

    const { data: hostMember } = await supabase
      .from("contest_members")
      .select("display_name")
      .eq("contest_id", sourceContestId)
      .eq("user_id", user.id)
      .eq("role", "host")
      .maybeSingle();

    const hostName =
      (typeof hostMember?.display_name === "string" && hostMember.display_name.trim()) ||
      "Host";

    const candidateSource = String(
      source.candidate_source ?? "user_single",
    ) as CandidateSource;

    const settings = {
      theme: source.theme ?? "generic",
      candidate_source: candidateSource,
      max_nominations_per_participant: source.max_nominations_per_participant ?? 1,
      requires_contest_unlock: false,
      max_curated_candidates: source.max_candidates,
      allow_duplicate_candidates: source.allow_duplicate_candidates === true,
      host_participates: source.host_participates !== false,
      nomination_deadline: "",
      candidate_reveal: source.candidate_reveal ?? "live",
      candidate_sort: source.candidate_sort ?? "as_entered",
      voting_access: "after_release",
      vote_mutability: source.vote_mutability ?? "editable_until_close",
      voting_close_mode: "manual",
      voting_closes_at: "",
      scoring_model: source.scoring_model ?? "linear_x",
      results_reveal: source.results_reveal ?? "immediate",
      ballot_reveal_order: source.ballot_reveal_order ?? "alphabetical",
      nomination_kind: source.nomination_kind ?? "standard",
      chart_country: parseChartCountry(String(source.chart_country ?? "US")),
      nominator_ranking:
        source.nominator_ranking !== false &&
        allowsNominatorRanking(
          candidateSource,
          (source.nomination_kind ?? "standard") === "birthday"
            ? "birthday"
            : "standard",
        ),
      nominator_ranking_when: source.nominator_ranking_when ?? "after",
      nominator_results_reveal: source.nominator_results_reveal ?? "immediate",
      allow_vote_own_nominations: source.allow_vote_own_nominations === true,
      results_anonymous: source.results_anonymous === true,
    };

    const { data, error } = await supabase.rpc("create_contest", {
      p_title: effectiveContestTitle(String(source.title ?? "")),
      p_host_name: hostName,
      p_description: source.description || null,
      p_settings: settings,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    const result = data as { id?: string; join_code: string };
    const contestId = typeof result.id === "string" ? result.id : null;
    if (!contestId) {
      return { error: "Contest was created but the id was missing." };
    }

    const extras: Record<string, unknown> = {
      candidate_title: normalizeCandidateTitleInput(
        String(source.candidate_title ?? ""),
      ),
      show_star_points: source.show_star_points === true,
      show_nominees: source.show_nominees === true,
      auto_start_voting: source.auto_start_voting === true,
      results_anonymous: source.results_anonymous === true,
      birthday_offset_amount: source.birthday_offset_amount ?? 0,
      birthday_offset_unit: source.birthday_offset_unit ?? "years",
    };
    if (settings.theme === "song") {
      extras.song_links = parseSongLinksMode(source.song_links);
    }
    const durationSeconds =
      typeof source.nomination_duration_seconds === "number" &&
      source.nomination_duration_seconds >= 1
        ? clampNominationDurationSeconds(source.nomination_duration_seconds)
        : null;
    if (durationSeconds != null) {
      extras.nomination_duration_seconds = durationSeconds;
      extras.nominations_open = false;
      extras.nomination_deadline = null;
    }

    const { error: extrasError } = await supabase
      .from("contests")
      .update(extras)
      .eq("id", contestId);
    if (extrasError && !extrasError.message.includes("does not exist")) {
      // Best-effort: contest exists; continue cloning candidates.
    }

    const { data: questions } = await supabase
      .from("contest_questions")
      .select("id, name, sort_order")
      .eq("contest_id", sourceContestId)
      .order("sort_order", { ascending: true });

    // Single-topic model: keep the first question only.
    const sourceQuestion = (questions ?? [])[0] ?? null;
    let newQuestionId: string | null = null;
    if (sourceQuestion?.name) {
      const { data: seedQuestionsData, error: seedError } = await supabase.rpc(
        "seed_contest_questions",
        {
          p_contest_id: contestId,
          p_questions: [{ name: effectiveTopicName(String(sourceQuestion.name)) }],
        },
      );
      if (seedError) {
        return { error: mapRpcError(seedError.message) };
      }
      const ids = parseQuestionIdsFromSeed(seedQuestionsData);
      newQuestionId = ids[0] ?? null;
    }

    const { data: candidates, error: candidatesError } = await supabase
      .from("candidates")
      .select("title, artist, url, description, question_id, status, meta")
      .eq("contest_id", sourceContestId)
      .neq("status", "withdrawn")
      .order("created_at", { ascending: true });

    if (candidatesError) {
      return { error: mapRpcError(candidatesError.message) };
    }

    const sourceQuestionId = sourceQuestion?.id ?? null;
    const toClone = (candidates ?? []).filter((row) => {
      const qid = (row.question_id as string | null) ?? null;
      if (!sourceQuestionId) return true;
      return qid == null || qid === sourceQuestionId;
    });

    if (toClone.length > 0) {
      await supabase
        .from("contests")
        .update({ max_candidates: toClone.length })
        .eq("id", contestId);
    }

    const anythingLabels: Array<{
      questionId: string;
      label: string;
      labelMode: string;
    }> = [];

    for (const row of toClone) {
      const title = String(row.title ?? "").trim();
      if (!title) continue;
      const url = typeof row.url === "string" ? row.url.trim() : "";
      const description =
        typeof row.description === "string" ? row.description.trim() : "";
      const artist = typeof row.artist === "string" ? row.artist.trim() : "";
      const { error: nomError } = await supabase.rpc("nominate_candidate", {
        p_contest_id: contestId,
        p_title: title,
        p_url: url || null,
        p_description: description || null,
        p_artist: artist || null,
        p_delete_photo_on_finish: false,
        // Shared pool for single-topic contests.
        p_question_id: null,
        p_as_curated: true,
      });
      if (nomError) {
        return { error: mapRpcError(nomError.message) };
      }
      if (settings.theme === "generic" && newQuestionId) {
        anythingLabels.push({
          questionId: newQuestionId,
          label: title,
          labelMode: "custom",
        });
      }
    }

    if (anythingLabels.length > 0) {
      await supabase.rpc("seed_anything_candidates", {
        p_contest_id: contestId,
        p_candidates: anythingLabels,
      });
    }

    if (settings.nomination_kind === "birthday") {
      const { data: birthdayRows } = await supabase
        .from("curated_birthday_entries")
        .select("display_name, birthday")
        .eq("contest_id", sourceContestId);
      for (const entry of birthdayRows ?? []) {
        const displayName = String(entry.display_name ?? "").trim();
        const birthday = String(entry.birthday ?? "").trim();
        if (!displayName || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) continue;
        await supabase.rpc("add_curated_birthday_entry", {
          p_contest_id: contestId,
          p_display_name: displayName,
          p_birthday: birthday,
          p_show_in_results: false,
        });
      }
    }

    revalidatePath("/");
    redirect(`/c/${result.join_code}?created=1`);
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function leaveContestAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const contestId = String(formData.get("contestId") ?? "").trim();

  if (!contestId) {
    return { error: "Missing contest id." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();
    const { error } = await supabase.rpc("leave_contest", {
      p_contest_id: contestId,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    const stayOnPage = String(formData.get("stayOnPage") ?? "") === "1";
    revalidatePath("/");
    if (stayOnPage) {
      return { success: true };
    }

    redirect("/?left=1");
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function removeContestMemberAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const contestId = String(formData.get("contestId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();
  const userId = String(formData.get("userId") ?? "").trim();
  const removeNominations =
    formData.get("removeNominations") === "on" ||
    formData.get("removeNominations") === "true" ||
    formData.get("removeNominations") === "1";

  if (!contestId || !userId) {
    return { error: "Missing participant." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();
    const { error } = await supabase.rpc("remove_contest_member", {
      p_contest_id: contestId,
      p_user_id: userId,
      p_remove_nominations: removeNominations,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    if (joinCode) revalidatePath(`/c/${joinCode}`);
    return {
      success: true,
      message: removeNominations
        ? "Participant and their nominations removed."
        : "Participant removed.",
    };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function nominateCandidateAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const contestId = String(formData.get("contestId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();
  const theme = String(formData.get("theme") ?? "generic").trim();
  let title = String(formData.get("title") ?? "").trim();
  const artist = String(formData.get("artist") ?? "").trim();
  const rawUrl = String(formData.get("url") ?? "").trim();
  let url =
    theme === "song" ? (normalizePreviewUrl(rawUrl) ?? "") : rawUrl;
  const description =
    theme === "song" || theme === "photo"
      ? ""
      : String(formData.get("description") ?? "").trim();

  if (theme === "photo" && !title) {
    const photo = formData.get("photo");
    const fileName =
      photo instanceof File && photo.name.trim()
        ? photo.name.replace(/\.[^.]+$/, "").trim()
        : "";
    title = fileName || "Photo";
  }
  const deletePhotoOnFinish =
    theme === "photo" &&
    String(formData.get("deletePhotoOnFinish") ?? "false") === "true";
  const asCurated = String(formData.get("asCurated") ?? "false") === "true";
  const questionId = String(formData.get("questionId") ?? "").trim() || null;

  if (!contestId || !title) {
    return { error: "Please enter a candidate title." };
  }
  if (theme === "song" && !artist) {
    return { error: "Please enter the artist name." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();

    if (theme === "photo") {
      const photo = formData.get("photo");
      if (!(photo instanceof File) || photo.size <= 0) {
        return { error: "Please choose a photo to nominate." };
      }
      const uploaded = await uploadContestPhoto(supabase, contestId, photo);
      if ("error" in uploaded) {
        return { error: uploaded.error };
      }
      url = uploaded.url;
    } else if (theme === "generic") {
      // Optional Anything attachment (same storage as curated create).
      const attachment = formData.get("attachment");
      if (attachment instanceof File && attachment.size > 0) {
        const uploaded = await uploadContestPhoto(supabase, contestId, attachment);
        if ("error" in uploaded) {
          return { error: uploaded.error };
        }
        url = uploaded.url;
      }
    }

    const { data, error } = await supabase.rpc("nominate_candidate", {
      p_contest_id: contestId,
      p_title: title,
      p_url: url || null,
      p_description: description || null,
      p_artist: artist || null,
      p_delete_photo_on_finish: deletePhotoOnFinish,
      p_question_id: questionId,
      p_as_curated: asCurated,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    if (theme === "song") {
      const candidateId =
        data &&
        typeof data === "object" &&
        "id" in data &&
        typeof (data as { id?: unknown }).id === "string"
          ? (data as { id: string }).id
          : null;
      await attachSpotifyLinkBestEffort(supabase, candidateId, title, artist);
    }

    if (joinCode) revalidatePath(`/c/${joinCode}`);
    return { success: true };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function nominateBirthdayAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const contestId = String(formData.get("contestId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();
  const birthday = String(formData.get("birthday") ?? "").trim();
  const showBirthday = String(formData.get("showBirthday") ?? "false") === "true";

  if (!contestId || !joinCode) {
    return { error: "Missing contest id." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
    return { error: "Please enter a valid birthday." };
  }

  try {
    const { findItunesPreview, resolveChartNumberOneWithFallback } = await import(
      "@/lib/charts/resolve"
    );
    const { supabase } = await ensureAnonymousSession();

    // Use contest setting (not client-provided chart country) for the lookup.
    const { data: contestRow, error: contestError } = await supabase
      .from("contests")
      .select("chart_country, birthday_offset_amount, birthday_offset_unit")
      .eq("id", contestId)
      .maybeSingle();
    if (contestError) {
      return { error: mapRpcError(contestError.message) };
    }
    const chartCountry = parseChartCountry(
      (contestRow as { chart_country?: string } | null)?.chart_country,
    );
    const offsetAmount = parseBirthdayOffsetAmount(
      (contestRow as { birthday_offset_amount?: number } | null)
        ?.birthday_offset_amount,
    );
    const offsetUnit = parseBirthdayOffsetUnit(
      (contestRow as { birthday_offset_unit?: string } | null)
        ?.birthday_offset_unit,
    );
    const lookupDate = applyBirthdayOffset(birthday, offsetAmount, offsetUnit);
    if (!lookupDate) {
      return { error: "Please enter a valid birthday." };
    }
    const resolved = await resolveChartNumberOneWithFallback(
      chartCountry,
      lookupDate,
    );

    if (!resolved) {
      const { error } = await supabase.rpc("register_birthday_no_match", {
        p_contest_id: contestId,
        p_birthday: birthday,
        p_show_birthday: showBirthday,
      });
      if (error) {
        return { error: mapRpcError(error.message) };
      }
      if (joinCode) revalidatePath(`/c/${joinCode}`);
      return {
        success: true,
        message:
          "Birthday saved. No chart #1 was found for that date, so you were not nominated.",
      };
    }

    const { hit, usedLatestFallback } = resolved;

    const itunesStore =
      chartCountry === "DE" ? "de" : chartCountry === "AT" ? "at" : chartCountry === "GB" ? "gb" : "us";
    const previewUrl = await findItunesPreview(hit.title, hit.artist, itunesStore);
    const { data, error } = await supabase.rpc("nominate_birthday_hit", {
      p_contest_id: contestId,
      p_birthday: birthday,
      p_show_birthday: showBirthday,
      p_title: hit.title,
      p_artist: hit.artist,
      p_url: previewUrl,
      p_chart_key: hit.chartKey,
      p_chart_date: hit.chartDate,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    const candidateId =
      data &&
      typeof data === "object" &&
      "candidate_id" in data &&
      typeof (data as { candidate_id?: unknown }).candidate_id === "string"
        ? (data as { candidate_id: string }).candidate_id
        : null;
    await attachSpotifyLinkBestEffort(supabase, candidateId, hit.title, hit.artist);

    if (joinCode) revalidatePath(`/c/${joinCode}`);
    const updated =
      data &&
      typeof data === "object" &&
      "updated" in data &&
      (data as { updated?: boolean }).updated === true;
    const fallbackNote = usedLatestFallback
      ? " The target chart date was not available yet, so the latest chart #1 was used."
      : "";
    return {
      success: true,
      message: updated
        ? `Birthday updated. Your chart hit stays private until reveal.${fallbackNote}`
        : `Birthday submitted. Your chart hit was nominated privately.${fallbackNote}`,
    };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function addCuratedBirthdayEntryAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const contestId = String(formData.get("contestId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const birthday = String(formData.get("birthday") ?? "").trim();

  if (!contestId || !displayName || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
    return { error: "Please enter a name and valid birth date." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();
    const { error } = await supabase.rpc("add_curated_birthday_entry", {
      p_contest_id: contestId,
      p_display_name: displayName,
      p_birthday: birthday,
      // Never show curated birth dates in results — no participant consent.
      p_show_in_results: false,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    if (joinCode) revalidatePath(`/c/${joinCode}`);
    return { success: true };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function deleteCuratedBirthdayEntryAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const contestId = String(formData.get("contestId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();
  const entryId = String(formData.get("entryId") ?? "").trim();

  if (!contestId || !entryId) {
    return { error: "Missing entry." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();
    const { error } = await supabase.rpc("delete_curated_birthday_entry", {
      p_entry_id: entryId,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    if (joinCode) revalidatePath(`/c/${joinCode}`);
    return { success: true };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function updateContestSettingsAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const contestId = String(formData.get("contestId") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!contestId || !title) {
    return { error: "Please fill in all required fields." };
  }

  const candidateSource = String(
    formData.get("candidateSource") ?? "user_single",
  ) as CandidateSource;
  const nominationKind =
    String(formData.get("nominationKind") ?? "standard") === "birthday"
      ? ("birthday" as const)
      : ("standard" as const);
  const resultsAnonymous =
    String(formData.get("resultsAnonymous") ?? "false") === "true";
  let nominatorRanking =
    String(formData.get("nominatorRanking") ?? "true") === "true";
  if (
    resultsAnonymous ||
    !allowsNominatorRanking(candidateSource, nominationKind)
  ) {
    nominatorRanking = false;
  }

  const settings = {
    theme: String(formData.get("theme") ?? "generic"),
    candidate_source: candidateSource,
    max_nominations_per_participant: Number(
      formData.get("maxNominationsPerParticipant") ?? 1,
    ),
    allow_duplicate_candidates:
      String(formData.get("allowDuplicateCandidates") ?? "false") === "true",
    host_participates: String(formData.get("hostParticipates") ?? "true") === "true",
    nomination_deadline: String(formData.get("nominationDeadline") ?? "").trim(),
    candidate_reveal: String(formData.get("candidateReveal") ?? "live"),
    candidate_sort: String(formData.get("candidateSort") ?? "as_entered"),
    voting_access: "after_release",
    vote_mutability: String(
      formData.get("voteMutability") ?? "editable_until_close",
    ),
    voting_close_mode: String(formData.get("votingCloseMode") ?? "manual"),
    voting_closes_at: String(formData.get("votingClosesAt") ?? "").trim(),
    scoring_model: String(formData.get("scoringModel") ?? "linear_x"),
    results_reveal: String(formData.get("resultsReveal") ?? "immediate"),
    ballot_reveal_order: String(
      formData.get("ballotRevealOrder") ?? "alphabetical",
    ),
    nomination_kind: nominationKind,
    chart_country: parseChartCountry(String(formData.get("chartCountry") ?? "US")),
    nominator_ranking: nominatorRanking,
    nominator_ranking_when: String(formData.get("nominatorRankingWhen") ?? "after"),
    nominator_results_reveal: String(
      formData.get("nominatorResultsReveal") ?? "immediate",
    ),
    allow_vote_own_nominations:
      candidateSource === "curated" ||
      String(formData.get("allowVoteOwnNominations") ?? "false") === "true",
    results_anonymous: resultsAnonymous,
    nominations_open: String(formData.get("nominationsOpen") ?? "true") === "true",
  };

  try {
    const { supabase } = await ensureAnonymousSession();
    const { error } = await supabase.rpc("update_contest_settings", {
      p_contest_id: contestId,
      p_title: title,
      p_description: description || null,
      p_settings: settings,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    const offsetAmount =
      settings.nomination_kind === "birthday"
        ? parseBirthdayOffsetAmount(formData.get("birthdayOffsetAmount"))
        : 0;
    const offsetUnit =
      settings.nomination_kind === "birthday"
        ? parseBirthdayOffsetUnit(formData.get("birthdayOffsetUnit"))
        : "years";
    const songLinksRaw = String(formData.get("songLinks") ?? "preview").trim();
    const songLinks =
      settings.theme === "song"
        ? songLinksRaw === "spotify" ||
          songLinksRaw === "none" ||
          songLinksRaw === "preview"
          ? songLinksRaw
          : "preview"
        : "preview";
    const candidateTitle = normalizeCandidateTitleInput(
      String(formData.get("candidateTitle") ?? ""),
    );
    const { error: offsetError } = await supabase
      .from("contests")
      .update({
        birthday_offset_amount: offsetAmount,
        birthday_offset_unit: offsetUnit,
        song_links: songLinks,
        candidate_title: candidateTitle,
      })
      .eq("id", contestId);
    if (offsetError && !offsetError.message.includes("candidate_title")) {
      return { error: mapRpcError(offsetError.message) };
    }

    const showStarPoints =
      isStarRatingModel(settings.scoring_model) &&
      String(formData.get("showStarPoints") ?? "false") === "true";
    const { error: starPointsError } = await supabase
      .from("contests")
      .update({ show_star_points: showStarPoints })
      .eq("id", contestId);
    if (
      starPointsError &&
      !starPointsError.message.includes("show_star_points")
    ) {
      return { error: mapRpcError(starPointsError.message) };
    }

    const hasParticipantNominations =
      settings.candidate_source === "user_single" ||
      settings.candidate_source === "user_multiple" ||
      settings.candidate_source === "combined";
    if (hasParticipantNominations && settings.nomination_kind !== "birthday") {
      const showNominees =
        String(formData.get("showNominees") ?? "false") === "true";
      const { error: showNomineesError } = await supabase
        .from("contests")
        .update({ show_nominees: showNominees })
        .eq("id", contestId);
      if (
        showNomineesError &&
        !showNomineesError.message.includes("show_nominees")
      ) {
        return { error: mapRpcError(showNomineesError.message) };
      }
    }

    return { success: true };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function updateCandidateAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const candidateId = String(formData.get("candidateId") ?? "").trim();
  const contestId = String(formData.get("contestId") ?? "").trim();
  const theme = String(formData.get("theme") ?? "generic").trim();
  let title = String(formData.get("title") ?? "").trim();
  const artist = String(formData.get("artist") ?? "").trim();
  const rawUrl = String(formData.get("url") ?? "").trim();
  let url =
    theme === "song" ? (normalizePreviewUrl(rawUrl) ?? "") : rawUrl;
  const description =
    theme === "song" || theme === "photo"
      ? ""
      : String(formData.get("description") ?? "").trim();

  if (theme === "photo" && !title) {
    const photo = formData.get("photo");
    const fileName =
      photo instanceof File && photo.name.trim()
        ? photo.name.replace(/\.[^.]+$/, "").trim()
        : "";
    title = fileName || "Photo";
  }
  const deletePhotoOnFinishRaw = formData.get("deletePhotoOnFinish");
  const deletePhotoOnFinish =
    theme === "photo" && deletePhotoOnFinishRaw != null
      ? String(deletePhotoOnFinishRaw) === "true"
      : null;

  if (!candidateId || !title) {
    return { error: "Please enter a candidate title." };
  }
  if (theme === "song" && !artist) {
    return { error: "Please enter the artist name." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();

    if (theme === "photo") {
      const photo = formData.get("photo");
      if (photo instanceof File && photo.size > 0) {
        if (!contestId) {
          return { error: "Missing contest id for photo upload." };
        }
        const uploaded = await uploadContestPhoto(supabase, contestId, photo);
        if ("error" in uploaded) {
          return { error: uploaded.error };
        }
        url = uploaded.url;
      }
      if (!url) {
        return { error: "Please choose a photo." };
      }
    } else if (theme === "generic") {
      const attachment = formData.get("attachment");
      if (attachment instanceof File && attachment.size > 0) {
        if (!contestId) {
          return { error: "Missing contest id for attachment upload." };
        }
        const uploaded = await uploadContestPhoto(supabase, contestId, attachment);
        if ("error" in uploaded) {
          return { error: uploaded.error };
        }
        url = uploaded.url;
      }
    }

    const { error } = await supabase.rpc("update_candidate", {
      p_candidate_id: candidateId,
      p_title: title,
      p_url: url || null,
      p_description: description || null,
      p_artist: artist || null,
      p_delete_photo_on_finish: deletePhotoOnFinish,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    if (theme === "song") {
      await attachSpotifyLinkBestEffort(supabase, candidateId, title, artist);
    }

    const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();
    if (joinCode) revalidatePath(`/c/${joinCode}`);
    return { success: true };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function withdrawCandidateAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const candidateId = String(formData.get("candidateId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();

  if (!candidateId) {
    return { error: "Candidate not found." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();
    const { error } = await supabase.rpc("withdraw_candidate", {
      p_candidate_id: candidateId,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    if (joinCode) revalidatePath(`/c/${joinCode}`);
    return { success: true };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function startVotingAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const contestId = String(formData.get("contestId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();

  if (!contestId || !joinCode) {
    return { error: "Missing contest id." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();
    const { error } = await supabase.rpc("start_voting", {
      p_contest_id: contestId,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    revalidatePath(`/c/${joinCode}`);
    redirect(`/c/${joinCode}?voting=1`);
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function closeVotingAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const contestId = String(formData.get("contestId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();

  if (!contestId || !joinCode) {
    return { error: "Missing contest id." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();
    const { error } = await supabase.rpc("close_voting", {
      p_contest_id: contestId,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    revalidatePath(`/c/${joinCode}`);
    redirect(`/c/${joinCode}?results=1`);
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function scheduleCloseVotingAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const contestId = String(formData.get("contestId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();
  const rawSeconds = String(formData.get("closeInSeconds") ?? "30").trim();
  const seconds = Math.floor(Number(rawSeconds));

  if (!contestId || !joinCode) {
    return { error: "Missing contest id." };
  }
  if (!Number.isFinite(seconds) || seconds < 5 || seconds > 3600) {
    return { error: "Choose a countdown between 5 and 3600 seconds." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();
    const { error } = await supabase.rpc("schedule_close_voting", {
      p_contest_id: contestId,
      p_seconds: seconds,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    revalidatePath(`/c/${joinCode}`);
    return { success: true };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function castBallotAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const contestId = String(formData.get("contestId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();
  const questionId = String(formData.get("questionId") ?? "").trim() || null;
  const rawRankings = String(formData.get("rankings") ?? "").trim();
  const rawRatings = String(formData.get("ratings") ?? "").trim();

  if (!contestId || !joinCode) {
    return { error: "Missing contest id." };
  }

  const hasRatings = rawRatings.length > 0;
  let rankings: string[] = [];
  let ratings: Record<string, number> | null = null;

  if (hasRatings) {
    try {
      ratings = parseStarRatings(JSON.parse(rawRatings) as unknown);
    } catch {
      return { error: "Please rate each candidate with 0–5 stars." };
    }
  } else {
    try {
      const parsed = JSON.parse(rawRankings) as unknown;
      if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
        return { error: "Please rank the required number of distinct candidates." };
      }
      rankings = parsed.map((item) => item.trim()).filter(Boolean);
    } catch {
      return { error: "Please rank the required number of distinct candidates." };
    }
  }

  try {
    const { supabase } = await ensureAnonymousSession();
    const { error } = await supabase.rpc("cast_ballot", {
      p_contest_id: contestId,
      p_rankings: rankings,
      p_question_id: questionId,
      ...(ratings ? { p_ratings: ratings } : {}),
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    // Inline votes (star ratings, best-only picks) and multi-question ballots stay on the page.
    if (questionId || ratings || String(formData.get("inline") ?? "") === "1") {
      revalidatePath(`/c/${joinCode}`);
      return { success: true };
    }

    redirect(`/c/${joinCode}?voted=1`);
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function advanceResultsRevealAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const contestId = String(formData.get("contestId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();

  if (!contestId || !joinCode) {
    return { error: "Missing contest id." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();
    const { error } = await supabase.rpc("advance_results_reveal", {
      p_contest_id: contestId,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    // Opt-out photos are cleared in DB when results_phase becomes done;
    // flush Storage objects while the host session still has write access.
    const { data: contestAfter } = await supabase
      .from("contests")
      .select("results_phase")
      .eq("id", contestId)
      .maybeSingle();

    if (contestAfter?.results_phase === "done") {
      try {
        await flushPendingContestPhotoDeletes(supabase, contestId);
      } catch {
        // URLs already cleared in DB; Storage cleanup is best-effort.
      }
    }

    revalidatePath(`/c/${joinCode}`);
    return { success: true };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function closeNominationsAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const contestId = String(formData.get("contestId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();

  if (!contestId || !joinCode) {
    return { error: "Missing contest id." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();
    const { error } = await supabase.rpc("close_nominations", {
      p_contest_id: contestId,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    revalidatePath(`/c/${joinCode}`);
    return { success: true };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function openNominationsAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const contestId = String(formData.get("contestId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();

  if (!contestId || !joinCode) {
    return { error: "Missing contest id." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();
    const { error } = await supabase.rpc("open_nominations", {
      p_contest_id: contestId,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    revalidatePath(`/c/${joinCode}`);
    return { success: true };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function reopenVotingAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const contestId = String(formData.get("contestId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();

  if (!contestId || !joinCode) {
    return { error: "Missing contest id." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();
    const { error } = await supabase.rpc("reopen_voting", {
      p_contest_id: contestId,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    revalidatePath(`/c/${joinCode}`);
    return { success: true };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function scheduleCloseNominationsAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const contestId = String(formData.get("contestId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();
  const rawSeconds = String(formData.get("closeInSeconds") ?? "30").trim();
  const seconds = Math.floor(Number(rawSeconds));

  if (!contestId || !joinCode) {
    return { error: "Missing contest id." };
  }
  if (!Number.isFinite(seconds) || seconds < 5 || seconds > 3600) {
    return { error: "Choose a countdown between 5 and 3600 seconds." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();
    const { error } = await supabase.rpc("schedule_close_nominations", {
      p_contest_id: contestId,
      p_seconds: seconds,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    revalidatePath(`/c/${joinCode}`);
    return { success: true };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function revealAllCandidatesAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const contestId = String(formData.get("contestId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();

  if (!contestId || !joinCode) {
    return { error: "Missing contest id." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();

    const { data: contestRow, error: contestError } = await supabase
      .from("contests")
      .select(
        "nomination_kind, candidate_source, chart_country, birthday_offset_amount, birthday_offset_unit",
      )
      .eq("id", contestId)
      .maybeSingle();

    if (contestError) {
      return { error: mapRpcError(contestError.message) };
    }

    const isCuratedBirthday =
      (contestRow as { nomination_kind?: string })?.nomination_kind === "birthday" &&
      (contestRow as { candidate_source?: string })?.candidate_source === "curated";

    if (isCuratedBirthday) {
      const { findItunesPreview, resolveChartNumberOneWithFallback } = await import(
        "@/lib/charts/resolve"
      );
      const chartCountry = parseChartCountry(
        (contestRow as { chart_country?: string }).chart_country,
      );
      const offsetAmount = parseBirthdayOffsetAmount(
        (contestRow as { birthday_offset_amount?: number }).birthday_offset_amount,
      );
      const offsetUnit = parseBirthdayOffsetUnit(
        (contestRow as { birthday_offset_unit?: string }).birthday_offset_unit,
      );
      const itunesStore =
        chartCountry === "DE"
          ? "de"
          : chartCountry === "AT"
            ? "at"
            : chartCountry === "GB"
              ? "gb"
              : "us";

      const { data: entries, error: entriesError } = await supabase
        .from("curated_birthday_entries")
        .select("id, birthday")
        .eq("contest_id", contestId)
        .is("candidate_id", null)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (entriesError) {
        return { error: mapRpcError(entriesError.message) };
      }

      let linked = 0;

      for (const entry of entries ?? []) {
        const birthday = entry.birthday as string;
        const lookupDate = applyBirthdayOffset(birthday, offsetAmount, offsetUnit);
        if (!lookupDate) continue;
        const resolved = await resolveChartNumberOneWithFallback(
          chartCountry,
          lookupDate,
        );
        if (!resolved) {
          continue;
        }
        const { hit } = resolved;
        const previewUrl = await findItunesPreview(hit.title, hit.artist, itunesStore);
        const { data: linkData, error: linkError } = await supabase.rpc(
          "link_curated_birthday_hit",
          {
            p_entry_id: entry.id as string,
            p_title: hit.title,
            p_artist: hit.artist,
            p_url: previewUrl,
            p_chart_key: hit.chartKey,
            p_chart_date: hit.chartDate,
          },
        );
        if (linkError) {
          return { error: mapRpcError(linkError.message) };
        }
        const linkedCandidateId =
          linkData &&
          typeof linkData === "object" &&
          "candidate_id" in linkData &&
          typeof (linkData as { candidate_id?: unknown }).candidate_id === "string"
            ? (linkData as { candidate_id: string }).candidate_id
            : null;
        await attachSpotifyLinkBestEffort(
          supabase,
          linkedCandidateId,
          hit.title,
          hit.artist,
        );
        linked += 1;
      }

      if (linked === 0 && (entries?.length ?? 0) > 0) {
        return {
          error:
            "No chart #1 hits were found for the pending entries. Check dates and chart country.",
        };
      }
    }

    const { error } = await supabase.rpc("reveal_all_candidates", {
      p_contest_id: contestId,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    redirect(`/c/${joinCode}?revealed=1`);
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function revealCandidateAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const candidateId = String(formData.get("candidateId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();

  if (!candidateId || !joinCode) {
    return { error: "Candidate not found." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();
    const { error } = await supabase.rpc("reveal_candidate", {
      p_candidate_id: candidateId,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    revalidatePath(`/c/${joinCode}`);
    return { success: true };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

export async function revealNextCandidateAction(
  _prev: ContestActionState,
  formData: FormData,
): Promise<ContestActionState> {
  const contestId = String(formData.get("contestId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();

  if (!contestId || !joinCode) {
    return { error: "Missing contest id." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();
    const { error } = await supabase.rpc("reveal_next_candidate", {
      p_contest_id: contestId,
    });

    if (error) {
      return { error: mapRpcError(error.message) };
    }

    revalidatePath(`/c/${joinCode}`);
    return { success: true };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapRpcError(message) };
  }
}

/** Host-only: resolve Spotify links for song candidates that are still missing one. */
export async function resolveMissingSpotifyLinksAction(
  contestId: string,
  joinCode: string,
): Promise<{ resolved: number; error?: string }> {
  if (!contestId) {
    return { resolved: 0, error: "Missing contest id." };
  }

  try {
    const { supabase, user } = await ensureAnonymousSession();

    const { data: contestRow, error: contestError } = await supabase
      .from("contests")
      .select("host_user_id, theme")
      .eq("id", contestId)
      .maybeSingle();

    if (contestError) {
      return { resolved: 0, error: mapRpcError(contestError.message) };
    }
    if (!contestRow || contestRow.host_user_id !== user.id) {
      return { resolved: 0, error: "Only the host can do that." };
    }
    if (contestRow.theme !== "song") {
      return { resolved: 0 };
    }

    const { data: rows, error: candidatesError } = await supabase
      .from("candidates")
      .select("id, title, artist, meta, status")
      .eq("contest_id", contestId)
      .neq("status", "withdrawn");

    if (candidatesError) {
      return { resolved: 0, error: mapRpcError(candidatesError.message) };
    }

    let resolved = 0;
    for (const row of rows ?? []) {
      const meta =
        row.meta && typeof row.meta === "object"
          ? (row.meta as Record<string, unknown>)
          : {};
      if (typeof meta.spotify_url === "string" && meta.spotify_url.trim()) {
        continue;
      }
      const title = typeof row.title === "string" ? row.title : "";
      const artist = typeof row.artist === "string" ? row.artist : "";
      if (!title || !artist) continue;

      const ok = await attachSpotifyLinkBestEffort(
        supabase,
        row.id as string,
        title,
        artist,
      );
      if (ok) resolved += 1;
    }

    if (resolved > 0 && joinCode) {
      revalidatePath(`/c/${joinCode}`);
    }
    return { resolved };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { resolved: 0, error: mapRpcError(message) };
  }
}
