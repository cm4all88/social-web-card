/**
 * Turns a queued email (template + payload) into the finished message:
 * subject, branded HTML, plain text, sender and the unsubscribe headers.
 * Pure: the Owner Console uses it in the browser for previews, and the
 * dispatcher uses it on the server to send.
 */
import { BRAND, MAILING_ADDRESS, REPLY_TO, SENDERS, SITE_URL } from "./brand";
import { renderHtml, renderText, type EmailContent, type FooterContext } from "./layout";
import { OPTIONAL_CATEGORIES, TEMPLATE_BY_ID, type EmailCategory, type Payload } from "./templates";

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
  from: string;
  replyTo: string | null;
  headers: Record<string, string>;
  category: EmailCategory;
};

export type RenderOptions = {
  category?: EmailCategory;
  /** The person's unsubscribe token; optional email gets one-click links. */
  unsubscribeToken?: string | null;
  isTest?: boolean;
};

export class UnknownTemplateError extends Error {}
export class MarketingNotReadyError extends Error {}

const REASONS: Record<EmailCategory, string> = {
  account: "You're getting this because you have a Yooits.me account.",
  security:
    "This is a security notice about your Yooits.me account. We send these to keep your account safe.",
  billing: "You're getting this because of a payment or plan change on your Yooits.me account.",
  messages: "You're getting this because someone messaged you on Yooits.me.",
  activity: "You're getting this because of activity on your Yooits.me page.",
  marketing: "You're getting this because you asked for news from Yooits.me.",
  admin: "Owner alert for Yooits.me. Sent to the admin address set in the Owner Console.",
};

function senderFor(c: EmailCategory): string {
  if (c === "messages" || c === "activity") return SENDERS.notifications;
  if (c === "marketing") return SENDERS.news;
  if (c === "admin") return SENDERS.admin;
  return SENDERS.account;
}

export function unsubscribeUrls(token: string, category: EmailCategory) {
  const t = encodeURIComponent(token);
  return {
    // The page link people click (shows the result and the other choices).
    page: `${SITE_URL}/email/preferences?t=${t}&unsubscribe=${category}`,
    preferences: `${SITE_URL}/email/preferences?t=${t}`,
    // RFC 8058 one-click endpoint mail apps call with a POST.
    oneClick: `${SITE_URL}/api/email/unsubscribe?t=${t}&c=${category}`,
  };
}

export function renderEmail(
  templateId: string,
  payload: Payload,
  opts: RenderOptions = {},
): RenderedEmail {
  const def = TEMPLATE_BY_ID[templateId];
  if (!def) throw new UnknownTemplateError(`Unknown email template ${templateId}`);
  const category = opts.category ?? def.category;
  if (category === "marketing" && !MAILING_ADDRESS && !opts.isTest) {
    throw new MarketingNotReadyError("Marketing email needs a postal address in the footer first.");
  }
  const content: EmailContent = def.build(payload ?? {});
  const optional = OPTIONAL_CATEGORIES.includes(category);
  const urls =
    optional && opts.unsubscribeToken ? unsubscribeUrls(opts.unsubscribeToken, category) : null;
  const footer: FooterContext = {
    reason: REASONS[category],
    unsubscribeUrl: urls?.page,
    preferencesUrl: urls?.preferences,
    mailingAddress:
      category === "marketing"
        ? (MAILING_ADDRESS ?? "Postal address goes here before marketing email is sent.")
        : null,
  };
  const subject = (opts.isTest ? "[Test] " : "") + content.subject;
  const headers: Record<string, string> = {};
  if (urls) {
    headers["List-Unsubscribe"] = `<${urls.oneClick}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return {
    subject,
    html: renderHtml({ ...content, subject }, footer),
    text: renderText(content, footer),
    from: senderFor(category),
    replyTo: category === "admin" ? null : REPLY_TO,
    headers,
    category,
  };
}

export { BRAND };
