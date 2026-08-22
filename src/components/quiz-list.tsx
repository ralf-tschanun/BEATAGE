"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { SiteSectionIcon } from "@/components/site-section-icon";
import type { DashboardQuiz } from "@/lib/quizzes/dashboard";
import { quizSourceLabel } from "@/lib/quiz-settings";
import type { SiteNavItemId } from "@/lib/site-nav-items";

function formatExpiresDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type QuizListProps = {
  title: string;
  emptyText: string;
  quizzes: DashboardQuiz[];
  sectionIcon?: Extract<SiteNavItemId, "hosted" | "joined">;
};

export function QuizList({
  title,
  emptyText,
  quizzes,
  sectionIcon,
}: QuizListProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        {sectionIcon ? <SiteSectionIcon id={sectionIcon} /> : null}
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      </div>

      {quizzes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-card/40">
          {quizzes.map((quiz) => (
            <li key={quiz.id}>
              <Link
                href={`/q/${quiz.join_code}`}
                className="flex flex-col gap-2 px-4 py-4 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate font-medium">{quiz.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {quizSourceLabel(quiz.source)} · code {quiz.join_code}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{quiz.status}</Badge>
                  {quiz.member_count != null ? (
                    <span className="text-xs text-muted-foreground">
                      {quiz.member_count}
                      {quiz.max_members != null ? ` / ${quiz.max_members}` : ""} players
                    </span>
                  ) : null}
                  {quiz.expires_at ? (
                    <span className="text-xs text-muted-foreground">
                      expires {formatExpiresDate(quiz.expires_at)}
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
