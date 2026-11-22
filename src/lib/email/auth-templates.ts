/**
 * Yooits-branded versions of the six emails Supabase Auth sends itself
 * (sign-up confirmation, invite, magic link, email change, password reset,
 * reauthentication). Supabase sends these through the Resend SMTP already
 * set up; the HTML and subject are pasted into Supabase's dashboard under
 * Authentication > Emails > Templates. The Owner Console shows each one with
 * a copy button, and supabase/templates/ holds the same files.
 *
 * {{ .ConfirmationURL }}, {{ .Token }} and {{ .NewEmail }} are Supabase's
 * own placeholders, filled in when it sends.
 */
import { renderHtml, type EmailContent } from "./layout";

export type AuthTemplate = {
  /** Supabase's name for it, as in the dashboard and config.toml. */
  id: "confirmation" | "invite" | "magic_link" | "email_change" | "recovery" | "reauthentication";
  label: string;
  subject: string;
  content: EmailContent;
};

const FOOTER = {
  reason:
    "You're getting this because someone used this email address on Yooits. If that wasn't you, you can ignore it.",
};

const ignore = {
  kind: "small" as const,
  text: "If you didn't ask for this, you can ignore this email. Nothing changes until the link is used.",
};

export const AUTH_TEMPLATES: AuthTemplate[] = [
  {
    id: "confirmation",
    label: "Confirm sign-up",
    subject: "Confirm your Yooits email",
    content: {
      subject: "Confirm your Yooits email",
      preheader: "One tap to finish setting up your Yooits page.",
      heading: "Confirm your email",
      blocks: [
        {
          kind: "p",
          text: "Welcome to Yooits! Confirm this email address to finish setting up your account.",
        },
      ],
      button: { label: "Confirm my email", url: "{{ .ConfirmationURL }}" },
      after: [ignore],
    },
  },
  {
    id: "invite",
    label: "Invite",
    subject: "You're invited to Yooits",
    content: {
      subject: "You're invited to Yooits",
      preheader: "Make one page for all your links and wishlists.",
      heading: "You're invited to Yooits",
      blocks: [
        {
          kind: "p",
          text: "You've been invited to make a Yooits page: one link for everything you share, plus wishlists people can shop from.",
        },
      ],
      button: { label: "Accept the invite", url: "{{ .ConfirmationURL }}" },
      after: [ignore],
    },
  },
  {
    id: "magic_link",
    label: "Magic link",
    subject: "Your Yooits sign-in link",
    content: {
      subject: "Your Yooits sign-in link",
      preheader: "Sign in to Yooits with one tap.",
      heading: "Sign in to Yooits",
      blocks: [
        { kind: "p", text: "Use this button to sign in. The link works once and expires soon." },
      ],
      button: { label: "Sign in", url: "{{ .ConfirmationURL }}" },
      after: [ignore],
    },
  },
  {
    id: "email_change",
    label: "Change email",
    subject: "Confirm your new Yooits email",
    content: {
      subject: "Confirm your new Yooits email",
      preheader: "Confirm the change to your sign-in email.",
      heading: "Confirm your new email",
      blocks: [
        { kind: "p", text: "Confirm that you want to use {{ .NewEmail }} to sign in to Yooits." },
      ],
      button: { label: "Confirm the change", url: "{{ .ConfirmationURL }}" },
      after: [
        {
          kind: "small",
          text: "If you didn't ask to change your email, don't use the link, and change your Yooits password.",
        },
      ],
    },
  },
  {
    id: "recovery",
    label: "Reset password",
    subject: "Reset your Yooits password",
    content: {
      subject: "Reset your Yooits password",
      preheader: "Choose a new password for Yooits.",
      heading: "Reset your password",
      blocks: [
        {
          kind: "p",
          text: "Someone asked to reset the password for your Yooits account. Use this button to choose a new one.",
        },
      ],
      button: { label: "Choose a new password", url: "{{ .ConfirmationURL }}" },
      after: [
        {
          kind: "small",
          text: "If you didn't ask for this, you can ignore this email. Your password stays the same.",
        },
      ],
    },
  },
  {
    id: "reauthentication",
    label: "Confirm it's you",
    subject: "Your Yooits verification code",
    content: {
      subject: "Your Yooits verification code",
      preheader: "Enter this code to confirm it's you.",
      heading: "Confirm it's you",
      blocks: [
        { kind: "p", text: "Enter this code in Yooits to continue:" },
        { kind: "code", text: "{{ .Token }}" },
      ],
      after: [
        { kind: "small", text: "If you didn't ask for this code, change your Yooits password." },
      ],
    },
  },
];

export function renderAuthTemplate(t: AuthTemplate): string {
  return renderHtml(t.content, FOOTER);
}
