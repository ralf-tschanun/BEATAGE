"use client";

import { useActionState, useEffect, useState } from "react";
import {
  sendContactMessageAction,
  type ContactActionState,
} from "@/app/actions/contact";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const initialState: ContactActionState = null;

type ContactFormProps = {
  /** Prefill when the visitor is signed in with an email account. */
  defaultEmail?: string | null;
};

export function ContactForm({ defaultEmail = null }: ContactFormProps) {
  const [state, action, pending] = useActionState(
    sendContactMessageAction,
    initialState,
  );
  const [email, setEmail] = useState(defaultEmail?.trim() ?? "");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (defaultEmail?.trim()) {
      setEmail(defaultEmail.trim());
    }
  }, [defaultEmail]);

  useEffect(() => {
    if (state?.success) {
      setMessage("");
    }
  }, [state?.success]);

  return (
    <form action={action} className="space-y-4">
      {/* Honeypot — leave empty */}
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      <div className="space-y-2">
        <Label htmlFor="contact-email">Your email</Label>
        <Input
          id="contact-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@email.com"
          disabled={pending}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="contact-message">Your message</Label>
        <Textarea
          id="contact-message"
          name="message"
          required
          minLength={10}
          maxLength={4000}
          rows={8}
          placeholder="How can we help?"
          disabled={pending}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {message.length}/4000
        </p>
      </div>

      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      {state?.success ? (
        <p
          className="rounded-2xl border border-border/60 bg-muted/40 px-3 py-2 text-sm text-foreground"
          role="status"
        >
          {state.success}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}
