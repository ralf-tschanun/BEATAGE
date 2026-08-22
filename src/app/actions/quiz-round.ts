"use server";

import { revalidatePath } from "next/cache";
import { findSpotifyTrack, getSpotifyTrackById } from "@/lib/spotify";

export type QuizRoundActionState = {
  error?: string;
  ok?: boolean;
} | null;

function mapError(message: string): string {
  if (message.includes("NOT_HOST")) return "Only the host can do that.";
  if (message.includes("NOT_MEMBER")) return "You are not in this quiz.";
  if (message.includes("ROUND_ALREADY_ACTIVE")) return "A round is already active.";
  if (message.includes("NO_TRACK_AVAILABLE")) return "Add curated tracks before starting.";
  if (message.includes("ROUND_NOT_ACTIVE")) return "This round is not open for guesses.";
  if (message.includes("INVALID_YEAR")) return "Enter a valid year between 1900 and 2100.";
  return message || "Something went wrong.";
}

export async function addCuratedTrackAction(
  _prev: QuizRoundActionState,
  formData: FormData,
): Promise<QuizRoundActionState> {
  const quizId = String(formData.get("quizId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();
  const trackName = String(formData.get("trackName") ?? "").trim();
  const artistName = String(formData.get("artistName") ?? "").trim();
  const spotifyTrackId = String(formData.get("spotifyTrackId") ?? "").trim();

  if (!quizId || !trackName) {
    return { error: "Track title is required." };
  }

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  let releaseYear: number | null = null;
  let originalReleaseYear: number | null = null;
  let albumArtUrl: string | null = null;
  let previewUrl: string | null = null;
  let resolvedSpotifyId = spotifyTrackId || null;

  if (spotifyTrackId) {
    const details = await getSpotifyTrackById(spotifyTrackId);
    if (details) {
      releaseYear = details.releaseYear;
      originalReleaseYear = details.originalReleaseYear;
      albumArtUrl = details.albumArtUrl;
      previewUrl = details.previewUrl;
      resolvedSpotifyId = details.id;
    }
  } else if (artistName) {
    const match = await findSpotifyTrack(trackName, artistName);
    if (match) {
      const details = await getSpotifyTrackById(match.id);
      if (details) {
        releaseYear = details.releaseYear;
        originalReleaseYear = details.originalReleaseYear;
        albumArtUrl = details.albumArtUrl;
        previewUrl = details.previewUrl;
        resolvedSpotifyId = details.id;
      }
    }
  }

  const { error } = await supabase.rpc("add_beatage_curated_track", {
    p_quiz_id: quizId,
    p_track_name: trackName,
    p_artist_name: artistName || null,
    p_spotify_track_id: resolvedSpotifyId,
    p_album_art_url: albumArtUrl,
    p_preview_url: previewUrl,
    p_release_year: releaseYear,
    p_original_release_year: originalReleaseYear,
  });

  if (error) return { error: mapError(error.message) };

  revalidatePath(`/q/${joinCode}`);
  return { ok: true };
}

export async function startRoundAction(
  _prev: QuizRoundActionState,
  formData: FormData,
): Promise<QuizRoundActionState> {
  const quizId = String(formData.get("quizId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const { error } = await supabase.rpc("start_beatage_round", {
    p_quiz_id: quizId,
    p_curated_track_id: null,
  });

  if (error) return { error: mapError(error.message) };

  revalidatePath(`/q/${joinCode}`);
  return { ok: true };
}

export async function submitGuessAction(
  _prev: QuizRoundActionState,
  formData: FormData,
): Promise<QuizRoundActionState> {
  const roundId = String(formData.get("roundId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();
  const guessedYear = Number(formData.get("guessedYear"));

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const { error } = await supabase.rpc("submit_beatage_guess", {
    p_round_id: roundId,
    p_guessed_year: guessedYear,
  });

  if (error) return { error: mapError(error.message) };

  revalidatePath(`/q/${joinCode}`);
  return { ok: true };
}

export async function closeRoundAction(
  _prev: QuizRoundActionState,
  formData: FormData,
): Promise<QuizRoundActionState> {
  const roundId = String(formData.get("roundId") ?? "").trim();
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const { error } = await supabase.rpc("close_beatage_round", {
    p_round_id: roundId,
  });

  if (error) return { error: mapError(error.message) };

  revalidatePath(`/q/${joinCode}`);
  return { ok: true };
}
