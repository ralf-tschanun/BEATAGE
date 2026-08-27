"use server";

import { revalidatePath } from "next/cache";
import {
  clampAutoInterruptAfterEmptyRounds,
  clampYearRangeTolerance,
  DEFAULT_QUIZ_SETTINGS,
  isLiveQuizSource,
  normalizeScoringModes,
  parseOverallReveal,
  presentsLeaderboardAtEnd,
  type BeatageQuizSettings,
  type ChartCountryCode,
  type ScoringModeId,
} from "@/lib/quiz-settings";
import { mergeQuizSettingsForStorage } from "@/lib/quiz-scoring";
import { effectiveQuizTitle } from "@/lib/create-quiz-wizard";
import { normalizeLastfmUsername } from "@/lib/lastfm";
import {
  seedCuratedTracksForQuiz,
  type QuizTrackInput,
} from "@/lib/quiz-tracks";
import {
  DEFAULT_MAX_CURATED_TRACKS,
  getQuizPlanLimits,
  QUIZ_UNLOCK_LIMITS,
  type PlanId,
} from "@/lib/quiz-plans";
import { ensureAnonymousSession } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export type QuizActionState = {
  error?: string;
  joinCode?: string;
  quizTitle?: string;
  success?: boolean;
  /** Invite dialog after wizard create — client opens host view on continue. */
  createdQuiz?: { joinCode: string; title: string };
  /** Full-page navigation after join (keeps anonymous session cookies). */
  redirectTo?: string;
  /** Polar checkout after unlock-at-create (payment_pending quiz). */
  checkoutUrl?: string;
} | null;

function mapQuizError(message: string): string {
  if (message.includes("TITLE_REQUIRED")) return "Please enter a quiz title.";
  if (message.includes("HOST_NAME_REQUIRED")) return "Please enter your name.";
  if (message.includes("DISPLAY_NAME_REQUIRED")) return "Please enter your name.";
  if (message.includes("ACTIVE_QUIZ_LIMIT")) {
    return "You reached the active quiz limit for your plan. Unlock this quiz once, upgrade, or finish an existing quiz.";
  }
  if (message.includes("NOT_PAYMENT_PENDING")) {
    return "This quiz is not waiting for unlock.";
  }
  if (message.includes("TRACKS_OVER_PLAN")) {
    const cap = message.split(":")[1]?.trim();
    return cap
      ? `This quiz has more than ${cap} songs. Remove songs to fit your plan, unlock once, or change your plan.`
      : "This quiz has too many songs for your plan. Remove songs, unlock once, or change your plan.";
  }
  if (message.includes("QUIZ_NOT_FOUND")) return "That quiz was not found.";
  if (message.includes("NOT_HOST")) return "Only the host can do that.";
  if (message.includes("NOT_A_MEMBER")) return "You are not a member of this quiz.";
  if (message.includes("MEMBER_NOT_FOUND")) return "That player was not found.";
  if (message.includes("CANNOT_REMOVE_HOST")) {
    return "The host cannot be removed from this quiz.";
  }
  if (message.includes("HOST_CANNOT_LEAVE")) {
    return "Hosts cannot leave their own quiz. Delete it instead.";
  }
  if (message.includes("QUIZ_NOT_JOINABLE")) return "This quiz is not open for joining.";
  if (message.includes("QUIZ_EXPIRED")) return "This quiz has expired.";
  if (message.includes("QUIZ_FULL")) {
    return "This quiz is full. Ask the host to unlock the quiz or change their plan for more players.";
  }
  if (message.includes("NOT_AUTHENTICATED") || message.toLowerCase().includes("auth session")) {
    return "Session expired. Refresh and try again.";
  }
  if (message.includes("Anonymous sign-in")) return message;
  return message || "Something went wrong.";
}

async function assertQuizHost(quizId: string, userId: string) {
  const admin = createAdminClient();
  const { data: quiz, error } = await admin
    .from("beatage_quizzes")
    .select("host_user_id")
    .eq("id", quizId)
    .maybeSingle();

  if (error || !quiz) {
    throw new Error("QUIZ_NOT_FOUND");
  }

  if (quiz.host_user_id !== userId) {
    throw new Error("NOT_HOST");
  }
}

async function assertQuizParticipant(quizId: string, userId: string) {
  const admin = createAdminClient();
  const { data: member, error } = await admin
    .from("beatage_quiz_members")
    .select("role")
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !member) {
    throw new Error("NOT_A_MEMBER");
  }

  if (member.role === "host") {
    throw new Error("HOST_CANNOT_LEAVE");
  }
}

async function deleteQuizForHost(quizId: string, userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("beatage_quizzes")
    .delete()
    .eq("id", quizId)
    .eq("host_user_id", userId)
    .select("id");

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.length) {
    throw new Error("QUIZ_NOT_FOUND");
  }
}

async function leaveQuizForParticipant(quizId: string, userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("beatage_quiz_members")
    .delete()
    .eq("quiz_id", quizId)
    .eq("user_id", userId)
    .eq("role", "participant")
    .select("id");

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.length) {
    throw new Error("NOT_A_MEMBER");
  }
}

/** Host removes a participant (and their guesses) from the quiz. */
async function removeQuizMemberByHost(
  quizId: string,
  hostUserId: string,
  targetUserId: string,
) {
  await assertQuizHost(quizId, hostUserId);

  if (targetUserId === hostUserId) {
    throw new Error("CANNOT_REMOVE_HOST");
  }

  const admin = createAdminClient();
  const { data: member, error: memberError } = await admin
    .from("beatage_quiz_members")
    .select("id, role")
    .eq("quiz_id", quizId)
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (memberError) {
    throw new Error(memberError.message);
  }
  if (!member) {
    throw new Error("MEMBER_NOT_FOUND");
  }
  if (member.role === "host") {
    throw new Error("CANNOT_REMOVE_HOST");
  }

  const { error: guessesError } = await admin
    .from("beatage_guesses")
    .delete()
    .eq("quiz_id", quizId)
    .eq("user_id", targetUserId);

  if (guessesError) {
    throw new Error(guessesError.message);
  }

  const { data, error } = await admin
    .from("beatage_quiz_members")
    .delete()
    .eq("id", member.id)
    .eq("role", "participant")
    .select("id");

  if (error) {
    throw new Error(error.message);
  }
  if (!data?.length) {
    throw new Error("MEMBER_NOT_FOUND");
  }

  await admin
    .from("beatage_quizzes")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", quizId);
}

export async function createQuizAction(
  _prev: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  const title = effectiveQuizTitle(String(formData.get("title") ?? ""));
  const hostName = String(formData.get("hostName") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const tracksPayload = String(formData.get("tracksJson") ?? "").trim();
  const settingsPayload = String(formData.get("settingsJson") ?? "").trim();
  const wizardCreate = String(formData.get("wizardCreate") ?? "") === "1";
  const requiresUnlock = String(formData.get("requiresQuizUnlock") ?? "") === "1";

  if (!title) return { error: "Please enter a quiz title." };
  if (!hostName) return { error: "Please enter your name." };

  let tracks: QuizTrackInput[] = [];
  if (tracksPayload) {
    try {
      const parsed = JSON.parse(tracksPayload) as QuizTrackInput[];
      if (!Array.isArray(parsed)) {
        return { error: "Invalid track list." };
      }
      tracks = parsed.filter((track) => track.title?.trim() && track.artist?.trim());
    } catch {
      return { error: "Invalid track list." };
    }
  }

  let settings: BeatageQuizSettings = { ...DEFAULT_QUIZ_SETTINGS };
  if (settingsPayload) {
    try {
      const parsed = JSON.parse(settingsPayload) as Partial<BeatageQuizSettings>;
      settings = {
        ...DEFAULT_QUIZ_SETTINGS,
        ...parsed,
        chartCountries: (parsed.chartCountries ?? DEFAULT_QUIZ_SETTINGS.chartCountries) as ChartCountryCode[],
        scoringModes: normalizeScoringModes(
          (parsed.scoringModes ?? DEFAULT_QUIZ_SETTINGS.scoringModes) as ScoringModeId[],
        ),
        yearRangeTolerance: clampYearRangeTolerance(
          parsed.yearRangeTolerance ?? DEFAULT_QUIZ_SETTINGS.yearRangeTolerance,
        ),
        combinedScoring: false,
        secondaryScoringMode: null,
        answerYearMode:
          parsed.answerYearMode === "original_recording" ||
          parsed.answerYearMode === "this_release"
            ? parsed.answerYearMode
            : DEFAULT_QUIZ_SETTINGS.answerYearMode,
        showTitleArtist: Boolean(
          parsed.showTitleArtist ?? DEFAULT_QUIZ_SETTINGS.showTitleArtist,
        ),
        showCorrectAnswer: Boolean(
          parsed.showCorrectAnswer ?? DEFAULT_QUIZ_SETTINGS.showCorrectAnswer,
        ),
        showOverallResults: Boolean(
          parsed.showOverallResults ?? DEFAULT_QUIZ_SETTINGS.showOverallResults,
        ),
        showResultDetails: Boolean(
          parsed.showResultDetails ?? DEFAULT_QUIZ_SETTINGS.showResultDetails,
        ),
        showOthersInPastResults: Boolean(
          parsed.showOthersInPastResults ??
            DEFAULT_QUIZ_SETTINGS.showOthersInPastResults,
        ),
        overallReveal: parseOverallReveal(parsed.overallReveal),
        autoInterruptAfterEmptyRounds: clampAutoInterruptAfterEmptyRounds(
          parsed.autoInterruptAfterEmptyRounds ??
            DEFAULT_QUIZ_SETTINGS.autoInterruptAfterEmptyRounds,
        ),
        lastfmUsername: normalizeLastfmUsername(
          typeof parsed.lastfmUsername === "string"
            ? parsed.lastfmUsername
            : DEFAULT_QUIZ_SETTINGS.lastfmUsername,
        ),
      };
      // Presentation mode forces the mid-quiz board hidden.
      if (presentsLeaderboardAtEnd(settings)) {
        settings.showOverallResults = false;
      }
      settings.combinedScoring = settings.scoringModes.length > 1;
      settings.secondaryScoringMode =
        settings.scoringModes.length > 1
          ? (settings.scoringModes.find((mode) => mode === "chart_was_one") ??
            settings.scoringModes[1] ??
            null)
          : null;
    } catch {
      return { error: "Invalid quiz settings." };
    }
  }

  const isLive = isLiveQuizSource(settings.source);
  if (wizardCreate && tracks.length < 1 && !isLive) {
    return { error: "Please add at least one song before creating the quiz." };
  }
  if (settings.source === "lastfm_live" && !settings.lastfmUsername) {
    return { error: "Enter your Last.fm username for live Spotify quizzes." };
  }

  // Live quizzes start in pre-round mode until the host clicks Start Quiz Now.
  const settingsForStore = isLive
    ? mergeQuizSettingsForStorage(settings, { quizStarted: false })
    : settings;

  try {
    const { supabase, user } = await ensureAnonymousSession();
    const { data: profile } = await supabase
      .from("beatage_profiles")
      .select("plan")
      .eq("id", user.id)
      .maybeSingle();
    const plan = getQuizPlanLimits((profile?.plan as PlanId | undefined) ?? "free");
    const songCap = requiresUnlock
      ? QUIZ_UNLOCK_LIMITS.maxCuratedTracks
      : plan.maxCuratedTracks;
    if (songCap != null && tracks.length > songCap) {
      return {
        error: requiresUnlock
          ? `Please keep the playlist to ${songCap} songs or fewer.`
          : `Please keep the playlist to ${songCap} songs or fewer (or unlock this quiz).`,
      };
    }

    const pSource =
      settings.source === "lastfm_live"
        ? "lastfm_live"
        : settings.source === "spotify_live"
          ? "spotify_live"
          : "curated";
    const { data, error } = await supabase.rpc("create_beatage_quiz", {
      p_title: title,
      p_host_name: hostName,
      p_description: description || null,
      p_source: pSource,
      p_settings: settingsForStore,
      p_chart_countries: settings.chartCountries,
      p_requires_unlock: requiresUnlock,
    });

    if (error) {
      return { error: mapQuizError(error.message) };
    }

    const payload = (typeof data === "object" && data !== null ? data : {}) as {
      join_code?: string;
      joinCode?: string;
      id?: string;
    };
    const joinCode = String(payload.join_code ?? payload.joinCode ?? "").trim().toUpperCase();
    const quizId = String(payload.id ?? "").trim();
    if (!joinCode || !quizId) {
      return { error: "Quiz was created but no join code was returned." };
    }

    // Always send the host to the quiz page after create (MyContest pattern).
    // Track seed errors must not leave the host stuck on /create with a reset draft.
    if (tracks.length > 0) {
      const seed = await seedCuratedTracksForQuiz(quizId, tracks);
      if (seed.error || seed.saved < tracks.length) {
        console.error(
          `Quiz ${quizId} created but tracks incomplete (${seed.saved}/${tracks.length}):`,
          seed.error,
        );
      }
    }

    revalidatePath("/");
    revalidatePath(`/q/${joinCode}`);

    if (requiresUnlock) {
      const checkoutPath = `/api/billing/checkout?sku=quiz_unlock&quizId=${encodeURIComponent(quizId)}`;
      // Guests must create an email account before Polar (MyContest pattern).
      const checkoutUrl = user.is_anonymous
        ? `/billing/account?next=${encodeURIComponent(checkoutPath)}`
        : checkoutPath;
      return {
        success: true,
        joinCode,
        quizTitle: title,
        checkoutUrl,
      };
    }

    // Client navigates — invite opens on host page via ?created=1.
    return { redirectTo: `/q/${joinCode}?created=1` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapQuizError(message) };
  }
}

export async function joinQuizAction(
  _prev: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();
  const displayName = String(formData.get("displayName") ?? "").trim();

  if (!joinCode) return { error: "Invite code is required." };
  if (!displayName) return { error: "Please enter your name." };

  try {
    const { supabase, user } = await ensureAnonymousSession();
    const { data, error } = await supabase.rpc("join_beatage_quiz", {
      p_join_code: joinCode,
      p_display_name: displayName,
    });

    if (error) {
      return { error: mapQuizError(error.message) };
    }

    const code = String((data as { join_code?: string })?.join_code ?? joinCode);
    revalidatePath("/");
    return { redirectTo: `/q/${code}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapQuizError(message) };
  }
}

export async function deleteQuizAction(
  _prev: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  const quizId = String(formData.get("quizId") ?? "").trim();

  if (!quizId) {
    return { error: "Missing quiz id." };
  }

  try {
    const { user } = await ensureAnonymousSession();
    await assertQuizHost(quizId, user.id);
    await deleteQuizForHost(quizId, user.id);

    const stayOnPage = String(formData.get("stayOnPage") ?? "") === "1";
    revalidatePath("/");
    if (stayOnPage) {
      return { success: true };
    }

    return { redirectTo: "/?deleted=1" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapQuizError(message) };
  }
}

export async function leaveQuizAction(
  _prev: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  const quizId = String(formData.get("quizId") ?? "").trim();

  if (!quizId) {
    return { error: "Missing quiz id." };
  }

  try {
    const { user } = await ensureAnonymousSession();
    await assertQuizParticipant(quizId, user.id);
    await leaveQuizForParticipant(quizId, user.id);

    const stayOnPage = String(formData.get("stayOnPage") ?? "") === "1";
    revalidatePath("/");
    if (stayOnPage) {
      return { success: true };
    }

    return { redirectTo: "/?left=1" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapQuizError(message) };
  }
}

export async function continueQuizWithPlanAction(
  _prev: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  const quizId = String(formData.get("quizId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();

  if (!quizId) {
    return { error: "Missing quiz." };
  }

  try {
    const { supabase } = await ensureAnonymousSession();
    const { data, error } = await supabase.rpc("beatage_continue_quiz_with_plan", {
      p_quiz_id: quizId,
    });

    if (error) {
      return { error: mapQuizError(error.message) };
    }

    const payload = (typeof data === "object" && data !== null ? data : {}) as {
      join_code?: string;
    };
    const code = String(payload.join_code ?? joinCode).trim().toUpperCase();

    revalidatePath("/");
    if (code) revalidatePath(`/q/${code}`);

    return {
      success: true,
      joinCode: code || undefined,
      redirectTo: code ? `/q/${code}` : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapQuizError(message) };
  }
}

export async function removeQuizMemberAction(
  _prev: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  const quizId = String(formData.get("quizId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();
  const userId = String(formData.get("userId") ?? "").trim();

  if (!quizId || !userId) {
    return { error: "Missing player." };
  }

  try {
    const { user } = await ensureAnonymousSession();
    await removeQuizMemberByHost(quizId, user.id, userId);

    revalidatePath("/");
    if (joinCode) revalidatePath(`/q/${joinCode}`);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapQuizError(message) };
  }
}
