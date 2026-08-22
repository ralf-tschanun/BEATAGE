"use client";

import { useActionState, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { updatePasswordAction, type AuthActionState } from "@/app/actions/auth";
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

const initialState: AuthActionState = null;

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(updatePasswordAction, initialState);
  const [mismatch, setMismatch] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
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

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) router.push("/");
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form action={formAction} className="grid gap-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Set a new password</DialogTitle>
            <DialogDescription>
              Choose a password for your account. You will use it to sign in next time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              autoFocus
              placeholder="At least 8 characters"
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password-confirm">Confirm password</Label>
            <Input
              id="new-password-confirm"
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
          {state?.error ? (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => router.push("/")}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
