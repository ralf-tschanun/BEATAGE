"use server";

import { revalidatePath } from "next/cache";
import {
  DEFAULT_QUIZ_SETTINGS,
  type BeatageQuizSettings,
  type ChartCountryCode,
  type ScoringModeId,
} from "@/lib/quiz-settings";
import {
  seedCuratedTracksForQuiz,
  type QuizTrackInput,
} from "@/lib/quiz-tracks";
import { DEFAULT_MAX_CURATED_TRACKS } from "@/lib/quiz-plans";
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
  if (message.includes("QUIZ_NOT_FOUND")) return "That quiz was not found.";
  if (message.includes("NOT_HOST")) return "Only the host can delete this quiz.";
  if (message.includes("NOT_A_MEMBER")) return "You are not a member of this quiz.";
  if (message.includes("HOST_CANNOT_LEAVE")) {
    return "Hosts cannot leave their own quiz. Delete it instead.";
  }
  if (message.includes("QUIZ_NOT_JOINABLE")) return "This quiz is not open for joining.";
  if (message.includes("QUIZ_EXPIRED")) return "This quiz has expired.";
  if (message.includes("QUIZ_FULL")) return "This quiz is full.";
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

export async function createQuizAction(
  _prev: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  const title = String(formData.get("title") ?? "").trim();
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

  if (wizardCreate && tracks.length < 1) {
    return { error: "Please add at least one song before creating the quiz." };
  }
  if (tracks.length > DEFAULT_MAX_CURATED_TRACKS && !requiresUnlock) {
    return {
      error: `Please keep the playlist to ${DEFAULT_MAX_CURATED_TRACKS} songs or fewer (or unlock this quiz).`,
    };
  }

  let settings: BeatageQuizSettings = { ...DEFAULT_QUIZ_SETTINGS };
  if (settingsPayload) {
    try {
      const parsed = JSON.parse(settingsPayload) as Partial<BeatageQuizSettings>;
      settings = {
        ...DEFAULT_QUIZ_SETTINGS,
        ...parsed,
        chartCountries: (parsed.chartCountries ?? DEFAULT_QUIZ_SETTINGS.chartCountries) as ChartCountryCode[],
        scoringModes: (parsed.scoringModes ?? DEFAULT_QUIZ_SETTINGS.scoringModes) as ScoringModeId[],
      };
    } catch {
      return { error: "Invalid quiz settings." };
    }
  }

  try {
    const { supabase, user } = await ensureAnonymousSession();
    const { data, error } = await supabase.rpc("create_beatage_quiz", {
      p_title: title,
      p_host_name: hostName,
      p_description: description || null,
      p_source: "curated",
      p_settings: settings,
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

    // Persist the free/plus song cap on the quiz row (unlock clears max_rounds).
    if (!requiresUnlock) {
      try {
        const admin = createAdminClient();
        await admin
          .from("beatage_quizzes")
          .update({ max_rounds: DEFAULT_MAX_CURATED_TRACKS })
          .eq("id", quizId)
          .is("unlocked_at", null);
      } catch {
        // Limit is still enforced in addCuratedTrackToQuiz / seed.
      }
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
