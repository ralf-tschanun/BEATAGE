"use server";

import { Resend } from "resend";
import { BRAND_NAME } from "@/lib/brand";

export type ContactActionState = {
  error?: string;
  success?: string;
} | null;

const MAX_MESSAGE_LENGTH = 4000;
const MAX_EMAIL_LENGTH = 254;

function parseEmail(raw: FormData): string | null {
  const email = String(raw.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function parseMessage(raw: FormData): string | null {
  const message = String(raw.get("message") ?? "").trim();
  if (message.length < 10 || message.length > MAX_MESSAGE_LENGTH) return null;
  return message;
}

/** Send a contact form message via Resend to the support inbox. */
export async function sendContactMessageAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  // Honeypot — bots often fill hidden fields.
  const honeypot = String(formData.get("company") ?? "").trim();
  if (honeypot) {
    return { success: "Thanks — your message was sent." };
  }

  const email = parseEmail(formData);
  const message = parseMessage(formData);
  if (!email) {
    return { error: "Enter a valid email address." };
  }
  if (!message) {
    return {
      error: `Enter a message between 10 and ${MAX_MESSAGE_LENGTH} characters.`,
    };
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = process.env.CONTACT_TO_EMAIL?.trim();
  const from =
    process.env.RESEND_FROM_EMAIL?.trim() ||
    `${BRAND_NAME} <onboarding@resend.dev>`;

  if (!apiKey || !to) {
    return {
      error:
        "Contact form is not configured yet. Please try again later.",
    };
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: [to],
      replyTo: email,
      subject: `${BRAND_NAME} contact from ${email}`,
      text: [
        `From: ${email}`,
        "",
        message,
        "",
        "—",
        `Sent via ${BRAND_NAME} contact form`,
      ].join("\n"),
    });

    if (error) {
      return {
        error:
          error.message ||
          "Could not send your message. Please try again in a moment.",
      };
    }

    return {
      success:
        "Thanks — your message was sent. We’ll get back to you by email.",
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Something went wrong.";
    return { error: detail };
  }
}
