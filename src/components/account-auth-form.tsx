"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
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

const ACCOUNT_NOTICE_KEY = "beatage:account-notice";

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

function readStoredNotice(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(ACCOUNT_NOTICE_KEY);
  } catch {
    return null;
  }
}

function writeStoredNotice(message: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (message) sessionStorage.setItem(ACCOUNT_NOTICE_KEY, message);
    else sessionStorage.removeItem(ACCOUNT_NOTICE_KEY);
  } catch {
    // ignore
  }
}

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
  const [signupStep, setSignupStep] = useState<"form" | "done">("form");
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
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupPasswordConfirm, setSignupPasswordConfirm] = useState("");
  const [signInEmail, setSignInEmail] = useState("");
  const signupEmailRef = useRef(signupEmail);
  signupEmailRef.current = signupEmail;

  const pending = savePending || signInPending || resetPending;
  const state = mode === "reset" ? resetState : signInState;
  const checkoutGate = Boolean(nextPath) || preferSignup;
  const needsEmailConfirmation = Boolean(
    saveState?.needsEmailConfirmation ||
      (accountNotice && /confirm your email/i.test(accountNotice)),
  );

  // Restore notice after refresh / remount (e.g. nav drawer).
  useEffect(() => {
    const stored = readStoredNotice();
    if (stored) setAccountNotice(stored);
  }, []);

  useEffect(() => {
    if (!saveState?.success) return;

    writeStoredNotice(saveState.success);
    setAccountNotice(saveState.success);
    setSignupStep("done");
    setSignupOpen(true);
    setSignupPassword("");
    setSignupPasswordConfirm("");
    setSignInEmail((prev) => signupEmailRef.current.trim() || prev);
  }, [saveState]);

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

  function resetSignupFields() {
    setMismatch(false);
    setSignupName("");
    setSignupEmail("");
    setSignupPassword("");
    setSignupPasswordConfirm("");
  }

  function openSignup() {
    resetSignupFields();
    setSignupStep("form");
    setSignupOpen(true);
  }

  function dismissSignupSuccess() {
    const continueTo = saveState?.redirectTo ?? nextPath;
    setSignupOpen(false);
    setSignupStep("form");
    // Keep accountNotice visible on the sign-in surface.
    if (!saveState?.needsEmailConfirmation && !needsEmailConfirmation) {
      // Fully signed in — refresh identity after the user has read the message.
      if (continueTo && continueTo !== "/") {
        if (continueTo.startsWith("/api/billing")) {
          goToBilling(continueTo);
          return;
        }
        router.push(continueTo);
      }
      router.refresh();
    }
  }

  function clearAccountNotice() {
    writeStoredNotice(null);
    setAccountNotice(null);
  }

  function handleSignupSubmit(event: FormEvent<HTMLFormElement>) {
    if (signupPassword !== signupPasswordConfirm) {
      event.preventDefault();
      setMismatch(true);
    } else {
      setMismatch(false);
    }
  }

  const noticeBlock = accountNotice ? (
    <p
      className={
        needsEmailConfirmation
          ? "rounded-2xl border border-border/60 bg-muted/40 px-3 py-2 text-sm text-foreground"
          : "text-sm text-foreground"
      }
      role="status"
    >
      {accountNotice}
    </p>
  ) : null;

  const signupSuccessDialog =
    signupOpen && signupStep === "done" ? (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) dismissSignupSuccess();
        }}
      >
        <DialogContent
          className="z-[80] sm:max-w-md"
          overlayClassName="z-[80]"
        >
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>
                {needsEmailConfirmation
                  ? "Confirm your email"
                  : "Account created"}
              </DialogTitle>
              <DialogDescription>
                {accountNotice ?? saveState?.success}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
              <Button type="button" onClick={dismissSignupSuccess}>
                {needsEmailConfirmation ? "Back to sign in" : "Continue"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    ) : null;

  // Keep the success dialog mounted even if identity flips to signed-in mid-flow.
  if (hasSession && !isAnonymous && signupStep !== "done") {
    if (nextPath) {
      return (
        <div className="space-y-3">
          {noticeBlock}
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
      <div className="space-y-3">
        {noticeBlock}
        <form action={signOutAction}>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {checkoutGate && isAnonymous && mode === "signin" && !needsEmailConfirmation ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          New here? Create an account on this device to keep pending contests.
          Already registered? Sign in below — we move any pending unlock on this
          device to that account, then continue to payment.
        </p>
      ) : null}

      {noticeBlock}

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
        onSubmit={() => clearAccountNotice()}
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
            value={signInEmail}
            onChange={(event) => setSignInEmail(event.target.value)}
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
                onClick={openSignup}
              >
                Create a new account
              </Button>
            ) : (
              <button
                type="button"
                className="text-left text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={openSignup}
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

      {signupSuccessDialog}

      <Dialog
        open={signupOpen && signupStep === "form"}
        onOpenChange={(open) => {
          if (pending) return;
          setSignupOpen(open);
          if (!open) {
            setMismatch(false);
            setSignupPassword("");
            setSignupPasswordConfirm("");
          }
        }}
      >
        <DialogContent
          className="z-[80] sm:max-w-md"
          overlayClassName="z-[80]"
        >
          <form
            action={saveAction}
            className="grid gap-4"
            onSubmit={handleSignupSubmit}
          >
            {nextPath ? (
              <input type="hidden" name="next" value={nextPath} />
            ) : null}
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
                value={signupName}
                onChange={(event) => setSignupName(event.target.value)}
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
                value={signupEmail}
                onChange={(event) => setSignupEmail(event.target.value)}
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
                value={signupPassword}
                onChange={(event) => setSignupPassword(event.target.value)}
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
                value={signupPasswordConfirm}
                onChange={(event) => {
                  setSignupPasswordConfirm(event.target.value);
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
