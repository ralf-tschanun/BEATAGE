"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { createQuizAction, type QuizActionState } from "@/app/actions/quiz";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BRAND_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

const initialState: QuizActionState = null;

export function CreateQuizForm() {
  const [state, formAction, pending] = useActionState(createQuizAction, initialState);

  useEffect(() => {
    if (state?.redirectTo && typeof window !== "undefined") {
      window.location.assign(state.redirectTo);
    }
  }, [state?.redirectTo]);

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      <SiteHeader identity={null} currentPlan="free" />
      <main className="mx-auto w-full max-w-lg flex-1 px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Create a quiz</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Start a {BRAND_NAME} session. You can configure rules and tracks in the next
          steps.
        </p>

        <form action={formAction} className="mt-8 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="title">Quiz title</Label>
            <Input
              id="title"
              name="title"
              placeholder="Friday night hits"
              required
              maxLength={80}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hostName">Your name (host)</Label>
            <Input
              id="hostName"
              name="hostName"
              placeholder="Alex"
              required
              maxLength={40}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Input
              id="description"
              name="description"
              placeholder="Release year guessing with friends"
              maxLength={500}
            />
          </div>

          {state?.error ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create quiz"}
            </Button>
            <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
              Cancel
            </Link>
          </div>
        </form>
      </main>
      <SiteFooter />
    </div>
  );
}
