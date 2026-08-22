"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DEFAULT_QUIZ_SETTINGS } from "@/lib/quiz-settings";
import { ensureAnonymousSession } from "@/lib/supabase/auth";

export type QuizActionState = {
  error?: string;
  joinCode?: string;
} | null;

function mapQuizError(message: string): string {
  if (message.includes("TITLE_REQUIRED")) return "Please enter a quiz title.";
  if (message.includes("HOST_NAME_REQUIRED")) return "Please enter your name.";
  if (message.includes("DISPLAY_NAME_REQUIRED")) return "Please enter your name.";
  if (message.includes("ACTIVE_QUIZ_LIMIT")) {
    return "You reached the active quiz limit for your plan. Upgrade or finish an existing quiz.";
  }
  if (message.includes("QUIZ_NOT_FOUND")) return "That invite code was not found.";
  if (message.includes("QUIZ_NOT_JOINABLE")) return "This quiz is not open for joining.";
  if (message.includes("QUIZ_EXPIRED")) return "This quiz has expired.";
  if (message.includes("QUIZ_FULL")) return "This quiz is full.";
  if (message.includes("NOT_AUTHENTICATED") || message.toLowerCase().includes("auth session")) {
    return "Session expired. Refresh and try again.";
  }
  if (message.includes("Anonymous sign-in")) return message;
  return message || "Something went wrong.";
}

export async function createQuizAction(
  _prev: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  const title = String(formData.get("title") ?? "").trim();
  const hostName = String(formData.get("hostName") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!title) return { error: "Please enter a quiz title." };
  if (!hostName) return { error: "Please enter your name." };

  try {
    const { supabase } = await ensureAnonymousSession();
    const { data, error } = await supabase.rpc("create_beatage_quiz", {
      p_title: title,
      p_host_name: hostName,
      p_description: description || null,
      p_source: "curated",
      p_settings: DEFAULT_QUIZ_SETTINGS,
      p_chart_countries: DEFAULT_QUIZ_SETTINGS.chartCountries,
    });

    if (error) {
      return { error: mapQuizError(error.message) };
    }

    const joinCode = String((data as { join_code?: string })?.join_code ?? "").trim();
    if (!joinCode) {
      return { error: "Quiz was created but no join code was returned." };
    }

    revalidatePath("/");
    redirect(`/q/${joinCode}`);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
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
    const { supabase } = await ensureAnonymousSession();
    const { data, error } = await supabase.rpc("join_beatage_quiz", {
      p_join_code: joinCode,
      p_display_name: displayName,
    });

    if (error) {
      return { error: mapQuizError(error.message) };
    }

    const code = String((data as { join_code?: string })?.join_code ?? joinCode);
    revalidatePath("/");
    redirect(`/q/${code}`);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapQuizError(message) };
  }
}
