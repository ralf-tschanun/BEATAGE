"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { claimGuestPaymentPendingContests } from "@/lib/claim-guest-contests";
import { claimGuestPaymentPendingQuizzes } from "@/lib/claim-guest-quizzes";
import { getOptionalUser } from "@/lib/supabase/auth";
import { getSiteUrl, safeNextPath } from "@/lib/site-url";

export type AuthActionState = {
  error?: string;
  success?: string;
  /** True when signup succeeded but email must be confirmed before sign-in. */
  needsEmailConfirmation?: boolean;
  /** Client navigates here when server redirect is unreliable. */
  redirectTo?: string;
} | null;

const MIN_PASSWORD_LENGTH = 8;

function parseEmail(raw: FormData): string | null {
  const email = String(raw.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function parseDisplayName(raw: FormData): string | null {
  const name = String(raw.get("displayName") ?? "").trim();
  if (name.length < 1 || name.length > 40) return null;
  return name;
}

function parsePassword(raw: FormData): string | null {
  const password = String(raw.get("password") ?? "");
  if (password.length < MIN_PASSWORD_LENGTH) return null;
  return password;
}

function parseNewPassword(raw: FormData):
  | { password: string }
  | { error: string } {
  const password = parsePassword(raw);
  const confirm = String(raw.get("passwordConfirm") ?? "");
  if (!password) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (confirm !== password) {
    return { error: "Passwords do not match." };
  }
  return { password };
}

function authRedirectTo(next = "/"): string {
  return `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(next)}`;
}

function isNextRedirect(error: unknown): boolean {
  return (
    typeof error === "object" &&
    !!error &&
    "digest" in error &&
    String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

function mapAuthError(message: string): string {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("already been registered") ||
    normalized.includes("already registered") ||
    normalized.includes("email address is already")
  ) {
    return "This email already has an account. Sign in instead — we will move any pending unlock on this device to that login.";
  }
  if (normalized.includes("invalid login") || normalized.includes("invalid credentials")) {
    return "Incorrect email or password.";
  }
  if (normalized.includes("email change")) {
    return `Could not send confirmation email (${message}). Check Supabase Auth email settings, then try again.`;
  }
  if (
    normalized.includes("error sending") ||
    normalized.includes("error sending confirmation")
  ) {
    return `Could not send email (${message}). Check Resend Enable Sending and Supabase SMTP.`;
  }
  if (normalized.includes("email not confirmed")) {
    return "Please confirm your email first. Check your inbox, or resend the confirmation email below.";
  }
  if (
    normalized.includes("password") &&
    (normalized.includes("verif") || normalized.includes("confirm"))
  ) {
    return "Please confirm your email first, then sign in. Check your inbox, or resend the confirmation email below.";
  }
  if (normalized.includes("rate") || normalized.includes("too many")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  return message || "Something went wrong.";
}

/** Create an email + password account (sends a signup confirmation email). */
export async function saveAccountAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = parseEmail(formData);
  const displayName = parseDisplayName(formData);
  const parsed = parseNewPassword(formData);
  if (!displayName) {
    return { error: "Enter a name (1–40 characters)." };
  }
  if (!email) {
    return { error: "Enter a valid email address." };
  }
  if ("error" in parsed) {
    return { error: parsed.error };
  }
  const password = parsed.password;

  const next = safeNextPath(String(formData.get("next") ?? ""));

  try {
    const { supabase, user } = await getOptionalUser();
    if (user && !user.is_anonymous) {
      return { error: "You are already signed in with an email account." };
    }

    // Prefer converting the guest in place so hosted contests (and unlock drafts)
    // keep the same user id. Fresh signUp would orphan payment_pending contests.
    if (user?.is_anonymous) {
      const { data: converted, error: convertError } = await supabase.auth.updateUser(
        {
          email,
          password,
          data: { display_name: displayName },
        },
        // Shared Supabase with MyContest — without this, confirm links fall back
        // to the project Site URL (MyContest) instead of Beatage.
        { emailRedirectTo: authRedirectTo(next) },
      );
      if (convertError) {
        return { error: mapAuthError(convertError.message) };
      }

      await supabase
        .from("profiles")
        .update({ display_name: displayName, updated_at: new Date().toISOString() })
        .eq("id", user.id);

      const { data: again } = await supabase.auth.getUser();
      const current = again.user ?? converted.user;
      // Email confirmation is usually required before the guest becomes a full account.
      const needsEmailConfirmation =
        !current ||
        Boolean(current.is_anonymous) ||
        !current.email_confirmed_at;

      if (needsEmailConfirmation) {
        // Do not revalidate yet — keep client action state so the notice stays visible.
        return {
          success:
            "Please confirm your email address. We’ve sent you a link — after you confirm, you can sign in.",
          needsEmailConfirmation: true,
        };
      }

      // Client shows the success dialog, then refreshes identity.
      return { success: "Account created. You are signed in." };
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: authRedirectTo(next),
        data: { display_name: displayName },
      },
    });

    if (error) {
      return { error: mapAuthError(error.message) };
    }

    // Supabase may return a user with no identities when the email is already registered.
    if (
      data.user &&
      !data.session &&
      Array.isArray(data.user.identities) &&
      data.user.identities.length === 0
    ) {
      return {
        error:
          "This email already has an account. Sign in instead — we will move any pending unlock on this device to that login.",
      };
    }

    if (data.user?.id) {
      await supabase
        .from("profiles")
        .update({ display_name: displayName, updated_at: new Date().toISOString() })
        .eq("id", data.user.id);
    }

    if (data.session) {
      // Client shows the success dialog, then refreshes / continues to next.
      return {
        success: "Account created. You are signed in.",
        redirectTo: next !== "/" ? next : undefined,
      };
    }

    return {
      success:
        "Please confirm your email address. We’ve sent you a link — after you confirm, you can sign in.",
      needsEmailConfirmation: true,
    };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapAuthError(message) };
  }
}

export async function signInWithPasswordAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = parseEmail(formData);
  const password = String(formData.get("password") ?? "");
  if (!email) {
    return { error: "Enter a valid email address." };
  }
  if (!password) {
    return { error: "Enter your password." };
  }

  const next = safeNextPath(String(formData.get("next") ?? ""));

  try {
    const { supabase, user } = await getOptionalUser();
    const guestUserId = user?.is_anonymous ? user.id : null;

    const { data: signedIn, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      const needsEmailConfirmation = /email not confirmed/i.test(error.message);
      return {
        error: mapAuthError(error.message),
        needsEmailConfirmation: needsEmailConfirmation || undefined,
      };
    }

    const signedInUserId = signedIn.user?.id;
    if (guestUserId && signedInUserId && guestUserId !== signedInUserId) {
      try {
        await claimGuestPaymentPendingContests(guestUserId, signedInUserId);
        await claimGuestPaymentPendingQuizzes(guestUserId, signedInUserId);
      } catch (claimError) {
        const message =
          claimError instanceof Error
            ? claimError.message
            : "Could not move your pending unlock to this account.";
        return {
          error: `${message} Sign in worked, but open quizzes you host and try unlock again — or create a new account on this device instead.`,
        };
      }
    }

    revalidatePath("/", "layout");
    // Prefer client navigation — server redirect from useActionState is unreliable.
    return { success: "Signed in.", redirectTo: next };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapAuthError(message) };
  }
}

export async function requestPasswordResetAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = parseEmail(formData);
  if (!email) {
    return { error: "Enter a valid email address." };
  }

  try {
    const { supabase } = await getOptionalUser();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: authRedirectTo("/auth/update-password"),
    });

    if (error) {
      return { error: mapAuthError(error.message) };
    }

    return { success: "Check your email for a link to set a new password." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapAuthError(message) };
  }
}

/** Resend signup / email-change confirmation (shared auth with MyContest). */
export async function resendConfirmationEmailAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = parseEmail(formData);
  if (!email) {
    return { error: "Enter a valid email address." };
  }

  const next = safeNextPath(String(formData.get("next") ?? ""));
  const emailRedirectTo = authRedirectTo(next);

  try {
    const { supabase } = await getOptionalUser();

    // Normal signUp uses type "signup"; guest→email via updateUser uses "email_change".
    const signupResend = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo },
    });
    if (!signupResend.error) {
      return {
        success:
          "Confirmation email sent. Check your inbox for the link, then sign in.",
        needsEmailConfirmation: true,
      };
    }

    const changeResend = await supabase.auth.resend({
      type: "email_change",
      email,
      options: { emailRedirectTo },
    });
    if (!changeResend.error) {
      return {
        success:
          "Confirmation email sent. Check your inbox for the link, then sign in.",
        needsEmailConfirmation: true,
      };
    }

    return {
      error: mapAuthError(
        signupResend.error.message || changeResend.error.message,
      ),
      needsEmailConfirmation: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapAuthError(message), needsEmailConfirmation: true };
  }
}

export async function updatePasswordAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = parseNewPassword(formData);
  if ("error" in parsed) {
    return { error: parsed.error };
  }
  const password = parsed.password;

  try {
    const { supabase, user } = await getOptionalUser();
    if (!user) {
      return { error: "Open the reset link from your email first." };
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      return { error: mapAuthError(error.message) };
    }

    revalidatePath("/", "layout");
    redirect("/");
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: mapAuthError(message) };
  }
}

export async function signOutAction(): Promise<void> {
  const { supabase } = await getOptionalUser();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
