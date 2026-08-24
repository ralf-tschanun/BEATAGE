"use client";

import { useActionState, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  requestPasswordResetAction,
  saveAccountAction,
  signInWithPasswordAction,
  signOutAction,
  type AuthActionState,
} from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { goToBilling } from "@/lib/billing-nav";

const initialState: AuthActionState = null;

type AccountAuthFormProps = {
  hasSession: boolean;
  isAnonymous: boolean;
  email?: string | null;
  displayName?: string | null;
  /** After sign-in / account create, continue here (in-app path only). */
  nextPath?: string;
  /**
   * Billing / checkout gate: emphasize create for guests (keeps contests) while
   * still offering sign-in to an existing account.
   */
  preferSignup?: boolean;
};

export function AccountAuthForm({
  hasSession,
  isAnonymous,
  nextPath,
  preferSignup = false,
}: AccountAuthFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  // Do not auto-open create — both sign-in and create must stay reachable.
  const [signupOpen, setSignupOpen] = useState(false);
  const [saveState, saveAction, savePending] = useActionState(
    saveAccountAction,
    initialState,
  );
  const [signInState, signInAction, signInPending] = useActionState(
    signInWithPasswordAction,
    initialState,
  );
  const [resetState, resetAction, resetPending] = useActionState(
    requestPasswordResetAction,
    initialState,
  );

  const [mismatch, setMismatch] = useState(false);
  const pending = savePending || signInPending || resetPending;
  const state = mode === "reset" ? resetState : signInState;
  const checkoutGate = Boolean(nextPath) || preferSignup;

  useEffect(() => {
    if (!saveState?.success) return;
    setSignupOpen(false);
    if (nextPath) {
      if (nextPath.startsWith("/api/billing")) {
        goToBilling(nextPath);
        return;
      }
      router.push(nextPath);
      router.refresh();
    }
  }, [saveState?.success, nextPath, router]);

  useEffect(() => {
    if (!signInState?.redirectTo) return;
    const target = signInState.redirectTo;
    if (target.startsWith("/api/billing")) {
      goToBilling(target);
      return;
    }
    router.push(target);
    router.refresh();
  }, [signInState?.redirectTo, router]);

  function handleSignupSubmit(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirm = String(data.get("passwordConfirm") ?? "");
    if (password !== confirm) {
      event.preventDefault();
      setMismatch(true);
    } else {
      setMismatch(false);
    }
  }

  if (hasSession && !isAnonymous) {
    if (nextPath) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            You are signed in. Continue to checkout.
          </p>
          <Button type="button" className="w-full" onClick={() => goToBilling(nextPath)}>
            Continue to checkout
          </Button>
        </div>
      );
    }
    return (
      <form action={signOutAction}>
        <Button type="submit" variant="outline" size="sm">
          Sign out
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      {checkoutGate && isAnonymous && mode === "signin" ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          New here? Create an account on this device to keep pending contests.
          Already registered? Sign in below — we move any pending unlock on this
          device to that account, then continue to payment.
        </p>
      ) : null}

      {mode === "signin" && checkoutGate ? (
        <p className="text-sm font-medium text-foreground">
          Sign in to existing account
        </p>
      ) : null}

      {mode === "reset" ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          We’ll email a link so you can set a new password.
        </p>
      ) : null}
      <form
        action={mode === "reset" ? resetAction : signInAction}
        className="space-y-2"
      >
        {nextPath && mode === "signin" ? (
          <input type="hidden" name="next" value={nextPath} />
        ) : null}
        <div className="space-y-1">
          <Label htmlFor="account-email">Email</Label>
          <Input
            id="account-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@email.com"
            disabled={pending}
          />
        </div>
        {mode === "signin" ? (
          <div className="space-y-1">
            <Label htmlFor="account-password">Password</Label>
            <Input
              id="account-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              placeholder="Password"
              disabled={pending}
            />
          </div>
        ) : null}
        <Button type="submit" size="sm" disabled={pending} className="w-full">
          {pending
            ? mode === "reset"
              ? "Sending…"
              : "Signing in…"
            : mode === "reset"
              ? "Send reset link"
              : "Sign in"}
        </Button>
      </form>
      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      {state?.success ? (
        <p className="text-sm text-foreground" role="status">
          {state.success}
        </p>
      ) : null}
      {saveState?.success ? (
        <p className="text-sm text-foreground" role="status">
          {saveState.success}
        </p>
      ) : null}
      <div className="flex flex-col items-stretch gap-2">
        {mode === "signin" ? (
          <>
            <button
              type="button"
              className="text-left text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => setMode("reset")}
            >
              Forgot password?
            </button>
            {checkoutGate ? (
              <Button
                type="button"
                variant={preferSignup ? "default" : "outline"}
                className="w-full"
                disabled={pending}
                onClick={() => {
                  setMismatch(false);
                  setSignupOpen(true);
                }}
              >
                Create a new account
              </Button>
            ) : (
              <button
                type="button"
                className="text-left text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() => {
                  setMismatch(false);
                  setSignupOpen(true);
                }}
              >
                Create an account
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            className="text-left text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onClick={() => setMode("signin")}
          >
            Back to sign in
          </button>
        )}
      </div>

      <Dialog
        open={signupOpen}
        onOpenChange={(open) => {
          if (pending) return;
          setSignupOpen(open);
          if (!open) setMismatch(false);
        }}
      >
        <DialogContent
          className="z-[80] sm:max-w-md"
          overlayClassName="z-[80]"
        >
          <form action={saveAction} className="grid gap-4" onSubmit={handleSignupSubmit}>
            {nextPath ? <input type="hidden" name="next" value={nextPath} /> : null}
            <DialogHeader>
              <DialogTitle>Create a new account</DialogTitle>
              <DialogDescription>
                {isAnonymous
                  ? "We’ll convert this guest session to an email login so contests on this device stay with you."
                  : "We’ll send one confirmation email."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="signup-name">Name</Label>
              <Input
                id="signup-name"
                name="displayName"
                type="text"
                autoComplete="name"
                required
                minLength={1}
                maxLength={40}
                autoFocus
                placeholder="Your name"
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-email">Email</Label>
              <Input
                id="signup-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@email.com"
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-password">Password</Label>
              <Input
                id="signup-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                placeholder="At least 8 characters"
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-password-confirm">Confirm password</Label>
              <Input
                id="signup-password-confirm"
                name="passwordConfirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                placeholder="Repeat password"
                disabled={pending}
                onChange={() => {
                  if (mismatch) setMismatch(false);
                }}
              />
            </div>
            {mismatch ? (
              <p className="text-sm text-destructive" role="alert">
                Passwords do not match.
              </p>
            ) : null}
            {saveState?.error ? (
              <p className="text-sm text-destructive" role="alert">
                {saveState.error}
              </p>
            ) : null}
            <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
              <Button type="submit" disabled={pending}>
                {savePending ? "Creating…" : "Create account"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setSignupOpen(false)}
              >
                Sign in to existing account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
