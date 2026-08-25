import { QUIZ_UNLOCK_LIMITS } from "@/lib/quiz-plans";

export type QuizPlanLimitKind = "rounds" | "songs" | "participants";

/** Parse ROUND_LIMIT:10 / TRACK_LIMIT:10 style errors. */
export function parseQuizPlanLimitError(
  message: string | null | undefined,
): { kind: QuizPlanLimitKind; cap: number } | null {
  if (!message) return null;
  const round = message.match(/ROUND_LIMIT:(\d+)/i);
  if (round) {
    const cap = Number(round[1]);
    if (Number.isFinite(cap) && cap > 0) return { kind: "rounds", cap };
  }
  const track = message.match(/TRACK_LIMIT:(\d+)/i);
  if (track) {
    const cap = Number(track[1]);
    if (Number.isFinite(cap) && cap > 0) return { kind: "songs", cap };
  }
  if (/QUIZ_FULL/i.test(message) || /participant limit/i.test(message)) {
    return { kind: "participants", cap: QUIZ_UNLOCK_LIMITS.maxMembers };
  }
  if (/maximum of (\d+) songs/i.test(message)) {
    const cap = Number(message.match(/maximum of (\d+) songs/i)?.[1]);
    if (Number.isFinite(cap) && cap > 0) return { kind: "songs", cap };
  }
  if (/round limit|rounds? on your plan|song limit/i.test(message)) {
    return { kind: "rounds", cap: 10 };
  }
  return null;
}

export function isQuizPlanLimitError(message: string | null | undefined): boolean {
  return parseQuizPlanLimitError(message) != null;
}
