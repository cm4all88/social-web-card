/**
 * Every email Yooits.me sends, in one place. Each template turns the payload
 * its database trigger (or server call) stores into the wording of the
 * email; layout.ts gives them all the same look.
 *
 * Stripe sends payment receipts, refund receipts and failed-payment notices
 * for Plus and tips, so no template here repeats them: these emails are about
 * what changed on Yooits.me (Plus on or off, a tip arriving), never a receipt.
 */
import { BRAND, SITE_URL } from "./brand";
import type { Block, EmailContent } from "./layout";

export type EmailCategory =
  "account" | "security" | "billing" | "messages" | "activity" | "marketing" | "admin";
export type Payload = Record<string, unknown>;

export type TemplateDef = {
  id: string;
  category: EmailCategory;
  label: string;
  /** What sends it, in plain words (shown in the Owner Console). */
  trigger: string;
  /** false: the template is ready but nothing in the app sends it yet. */
  wired: boolean;
  sample: Payload;
  build: (p: Payload) => EmailContent;
};

export const CATEGORY_LABELS: Record<EmailCategory, string> = {
  account: "Account",
  security: "Security",
  billing: "Plus, tips and payouts",
  messages: "Messages",
  activity: "Activity (wishlists, rewards)",
  marketing: "News and offers",
  admin: "Owner alerts",
};

/** Optional categories carry unsubscribe links; the rest are needed to keep an account. */
export const OPTIONAL_CATEGORIES: EmailCategory[] = ["messages", "activity", "marketing"];

// ---------------------------------------------------------------------------
const s = (v: unknown, fallback = "") => (typeof v === "string" && v.trim() ? v.trim() : fallback);
const name = (p: Payload) => s(p.display_name, s(p.username, "there"));
const hi = (p: Payload) => `Hi ${name(p)},`;
const p = (text: string): Block => ({ kind: "p", text });
const small = (text: string): Block => ({ kind: "small", text });
const callout = (text: string): Block => ({ kind: "callout", text });

export function money(cents: unknown, currency: unknown = "usd"): string {
  const n = typeof cents === "number" ? cents : Number(cents);
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: s(currency, "usd").toUpperCase(),
    }).format(n / 100);
  } catch {
    return `$${(n / 100).toFixed(2)}`;
  }
}

export function day(v: unknown): string {
  if (typeof v !== "string" && !(v instanceof Date)) return "";
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

const page = (p: Payload) =>
  s(p.username) ? `${SITE_URL}/${encodeURIComponent(s(p.username))}` : SITE_URL;
const notYou =
  "If this wasn't you, reset your password straight away and reply to this email so we can help secure your account.";
const testNote = (p: Payload): Block[] =>
  p.livemode === false ? [small("This happened in Stripe test mode. No real money moved.")] : [];

// ---------------------------------------------------------------------------
export const TEMPLATES: TemplateDef[] = [
  // Account -----------------------------------------------------------------
  {
    id: "welcome",
    category: "account",
    label: "Welcome",
    trigger: "A new account's page is created at sign-up.",
    wired: true,
    sample: { username: "maya", display_name: "Maya" },
    build: (d) => ({
      subject: "Welcome to Yooits.me",
      preheader: `Your page is ready at ${BRAND.site}/${s(d.username)}.`,
      heading: `Welcome to Yooits.me, ${name(d)}`,
      blocks: [
        p(
          `Your page is live at **${BRAND.site}/${s(d.username)}**. Add your links, pick a theme and share it anywhere you have a bio.`,
        ),
        {
          kind: "details",
          rows: [
            ["Your page", `${BRAND.site}/${s(d.username)}`],
            ["Links", "Unlimited, free"],
          ],
        },
      ],
      button: { label: "Set up my page", url: `${SITE_URL}/dashboard` },
      after: [small("Questions or ideas? Reply to this email. A real person reads it.")],
    }),
  },
  {
    id: "account_suspended",
    category: "account",
    label: "Account suspended",
    trigger: "An admin suspends the account in the Owner Console.",
    wired: true,
    sample: { username: "maya", display_name: "Maya" },
    build: (d) => ({
      subject: "Your Yooits.me account has been suspended",
      preheader: "Your page is hidden while we review your account.",
      heading: "Your account is suspended",
      blocks: [
        p(hi(d)),
        p(
          "We've suspended your Yooits.me account after a review against our Terms and Acceptable Use Policy. While it's suspended your page is hidden and you can't make changes.",
        ),
        p(
          "If you think this is a mistake, reply to this email and tell us what happened. We'll take another look.",
        ),
      ],
      button: { label: "Read the Acceptable Use Policy", url: `${SITE_URL}/legal/acceptable-use` },
    }),
  },
  {
    id: "account_restored",
    category: "account",
    label: "Account restored",
    trigger: "An admin lifts a suspension.",
    wired: true,
    sample: { username: "maya", display_name: "Maya" },
    build: (d) => ({
      subject: "Your Yooits.me account is back",
      preheader: "Your suspension has been lifted.",
      heading: "Welcome back",
      blocks: [
        p(hi(d)),
        p("We've lifted the suspension on your account. You can sign in and edit your page again."),
      ],
      button: { label: "Open my dashboard", url: `${SITE_URL}/dashboard` },
    }),
  },
  {
    id: "page_unpublished",
    category: "account",
    label: "Page hidden",
    trigger: "An admin unpublishes a page.",
    wired: true,
    sample: { username: "maya", display_name: "Maya" },
    build: (d) => ({
      subject: "Your Yooits.me page has been hidden",
      preheader: "Your account still works, but your page isn't public right now.",
      heading: "Your page is hidden",
      blocks: [
        p(hi(d)),
        p(
          `We've hidden **${BRAND.site}/${s(d.username)}** from the public after a review. You can still sign in, and nothing on your page has been deleted.`,
        ),
        p("Reply to this email if you'd like us to take another look."),
      ],
      button: { label: "Open my dashboard", url: `${SITE_URL}/dashboard` },
    }),
  },
  {
    id: "page_restored",
    category: "account",
    label: "Page public again",
    trigger: "An admin republishes a page.",
    wired: true,
    sample: { username: "maya", display_name: "Maya" },
    build: (d) => ({
      subject: "Your Yooits.me page is public again",
      preheader: `${BRAND.site}/${s(d.username)} is back.`,
      heading: "Your page is back",
      blocks: [p(hi(d)), p(`**${BRAND.site}/${s(d.username)}** is public again.`)],
      button: { label: "View my page", url: page(d) },
    }),
  },
  {
    id: "account_deleted",
    category: "account",
    label: "Account deleted",
    trigger: "A person deletes their own account.",
    wired: true,
    sample: { username: "maya", display_name: "Maya" },
    build: (d) => ({
      subject: "Your Yooits.me account has been deleted",
      preheader: "Your page and links are gone. This is your confirmation.",
      heading: "Your account is deleted",
      blocks: [
        p(hi(d)),
        p(
          `We've deleted your Yooits.me account and your page at ${BRAND.site}/${s(d.username)}. Your links, wishlists and settings are gone.`,
        ),
        small(
          "We keep payment records (tips and Plus) that tax and payment rules require, as the Privacy Policy explains. If you didn't ask for this, reply straight away.",
        ),
      ],
    }),
  },
  {
    id: "report_received",
    category: "account",
    label: "Report received",
    trigger: "A signed-in person reports a page, wishlist or message.",
    wired: true,
    sample: {
      username: "maya",
      display_name: "Maya",
      target_kind: "profile",
      target_username: "spammy",
      reason: "spam",
    },
    build: (d) => ({
      subject: "We got your report",
      preheader: "Thanks for helping keep Yooits.me safe.",
      heading: "Thanks for your report",
      blocks: [
        p(hi(d)),
        p(
          "We've received your report and a person will review it. We'll email you when we've looked at it.",
        ),
        {
          kind: "details",
          rows: [
            ["What you reported", kindLabel(d.target_kind)],
            ["Reason", reasonLabel(d.reason)],
          ],
        },
      ],
    }),
  },
  {
    id: "report_reviewed",
    category: "account",
    label: "Report reviewed",
    trigger: "An admin resolves or dismisses a report from a signed-in person.",
    wired: true,
    sample: {
      username: "maya",
      display_name: "Maya",
      target_kind: "profile",
      reason: "spam",
      outcome: "resolved",
    },
    build: (d) => ({
      subject: "We've reviewed your report",
      preheader: d.outcome === "resolved" ? "We took action." : "We looked into it.",
      heading: "Your report has been reviewed",
      blocks: [
        p(hi(d)),
        p(
          d.outcome === "resolved"
            ? "Thanks to your report, we've taken action. We don't share the details to protect everyone's privacy."
            : "We looked into your report and didn't find a breach of our rules this time. If anything changes, you can report it again.",
        ),
      ],
    }),
  },

  // Security ----------------------------------------------------------------
  {
    id: "password_changed",
    category: "security",
    label: "Password changed",
    trigger: "The account's password changes (reset or settings).",
    wired: true,
    sample: { username: "maya", display_name: "Maya", changed_at: "2026-11-22T18:30:00Z" },
    build: (d) => ({
      subject: "Your Yooits.me password was changed",
      preheader: "If this was you, there's nothing to do.",
      heading: "Your password was changed",
      blocks: [
        p(hi(d)),
        p(`The password for your Yooits.me account was changed on ${day(d.changed_at)} (UTC).`),
        callout(notYou),
      ],
      button: { label: "Reset my password", url: `${SITE_URL}/auth?mode=forgot` },
    }),
  },
  {
    id: "email_changed",
    category: "security",
    label: "Sign-in email changed",
    trigger: "The account's sign-in email changes. Sent to the old address.",
    wired: true,
    sample: {
      username: "maya",
      display_name: "Maya",
      new_email_masked: "m***@example.com",
      changed_at: "2026-11-22T18:30:00Z",
    },
    build: (d) => ({
      subject: "Your Yooits.me sign-in email was changed",
      preheader: `Your account now signs in with ${s(d.new_email_masked)}.`,
      heading: "Your sign-in email changed",
      blocks: [
        p(hi(d)),
        p(
          `Your Yooits.me account now signs in with **${s(d.new_email_masked)}**. We're letting you know at your old address in case this wasn't you.`,
        ),
        callout(
          "If you didn't make this change, reply to this email right away so we can lock the account and help you get it back.",
        ),
      ],
    }),
  },

  // Plus, tips and payouts --------------------------------------------------
  {
    id: "plus_started",
    category: "billing",
    label: "Plus started",
    trigger: "A Plus subscription becomes active (Stripe webhook).",
    wired: true,
    sample: {
      username: "maya",
      display_name: "Maya",
      amount_cents: 499,
      currency: "usd",
      period_end: "2026-12-22T00:00:00Z",
      livemode: true,
    },
    build: (d) => ({
      subject: "You're on Yooits.me Plus",
      preheader: "Premium themes and no Yooits.me branding are on.",
      heading: "Welcome to Yooits.me Plus",
      blocks: [
        p(hi(d)),
        p(
          "Plus is on. Premium themes and custom styling are unlocked, and you can hide the Yooits.me branding on your page.",
        ),
        {
          kind: "details",
          rows: [
            [
              "Plan",
              `Yooits.me Plus${s(String(d.amount_cents ?? "")) ? `, ${money(d.amount_cents, d.currency)}/month` : ""}`,
            ],
            ["Renews", day(d.period_end) || "Monthly"],
          ],
        },
        small(
          "Stripe emails your receipt separately. You can change or cancel Plus any time from your dashboard.",
        ),
        ...testNote(d),
      ],
      button: { label: "Try a premium theme", url: `${SITE_URL}/dashboard` },
    }),
  },
  {
    id: "plus_canceling",
    category: "billing",
    label: "Plus set to cancel",
    trigger: "A Plus subscription is set to cancel at the end of the period.",
    wired: true,
    sample: { username: "maya", display_name: "Maya", cancel_at: "2026-12-22T00:00:00Z" },
    build: (d) => ({
      subject: "Your Yooits.me Plus will end soon",
      preheader: `Plus stays on until ${day(d.cancel_at)}.`,
      heading: "Plus is set to end",
      blocks: [
        p(hi(d)),
        p(
          `You've cancelled Yooits.me Plus. It stays on until **${day(d.cancel_at)}**, and you won't be charged again.`,
        ),
        p("Changed your mind? You can keep Plus from your dashboard before then."),
        ...testNote(d),
      ],
      button: { label: "Keep Plus", url: `${SITE_URL}/dashboard` },
    }),
  },
  {
    id: "plus_resumed",
    category: "billing",
    label: "Plus kept",
    trigger: "A cancelled Plus subscription is switched back on before it ends.",
    wired: true,
    sample: { username: "maya", display_name: "Maya", period_end: "2026-12-22T00:00:00Z" },
    build: (d) => ({
      subject: "You're keeping Yooits.me Plus",
      preheader: "Your cancellation has been undone.",
      heading: "Plus will keep going",
      blocks: [
        p(hi(d)),
        p(
          `Your Plus subscription will renew as usual${day(d.period_end) ? ` on ${day(d.period_end)}` : ""}.`,
        ),
        ...testNote(d),
      ],
      button: { label: "Open my dashboard", url: `${SITE_URL}/dashboard` },
    }),
  },
  {
    id: "plus_ended",
    category: "billing",
    label: "Plus ended",
    trigger: "A Plus subscription ends or stops being active.",
    wired: true,
    sample: { username: "maya", display_name: "Maya" },
    build: (d) => ({
      subject: "Your Yooits.me Plus has ended",
      preheader: "Your page is still live with the free features.",
      heading: "Plus has ended",
      blocks: [
        p(hi(d)),
        p(
          "Your Yooits.me Plus subscription has ended. Your page and all your links stay live; premium themes switch back to a free theme and Yooits.me branding shows again.",
        ),
        small("If a payment didn't go through, Stripe will have emailed you about it."),
        ...testNote(d),
      ],
      button: { label: "Get Plus again", url: `${SITE_URL}/dashboard` },
    }),
  },
  {
    id: "founding_member",
    category: "billing",
    label: "Founding Member Plus",
    trigger: "A Founding Member code is redeemed (3 free months of Plus).",
    wired: true,
    sample: { username: "maya", display_name: "Maya", ends_at: "2027-02-22T00:00:00Z" },
    build: (d) => ({
      subject: "You're a Yooits.me Founding Member",
      preheader: `Plus is free until ${day(d.ends_at)}. No card needed.`,
      heading: "You're a Founding Member",
      blocks: [
        p(hi(d)),
        p(
          "Thank you for being one of the first creators on Yooits.me. Your Founding Member code gives you Yooits.me Plus free.",
        ),
        {
          kind: "details",
          rows: [
            ["Plus free until", day(d.ends_at)],
            ["Card needed", "No"],
            ["Renews automatically", "No"],
          ],
        },
        p(
          "We'd love your feedback as you set things up. Use the feedback box in your dashboard, or just reply.",
        ),
      ],
      button: { label: "Set up my page", url: `${SITE_URL}/dashboard` },
    }),
  },
  {
    id: "tip_received",
    category: "billing",
    label: "Tip received",
    trigger: "A tip payment succeeds (Stripe webhook). Live tipping is off until Stripe approves.",
    wired: true,
    sample: {
      username: "maya",
      display_name: "Maya",
      amount_cents: 1000,
      currency: "usd",
      supporter_name: "Sam",
      supporter_message: "Love your recipes!",
      livemode: true,
    },
    build: (d) => ({
      subject: `You got a ${money(d.amount_cents, d.currency)} tip on Yooits.me`,
      preheader: `${s(d.supporter_name, "Someone")} sent you a tip.`,
      heading: `${s(d.supporter_name, "Someone")} sent you a tip`,
      blocks: [
        p(hi(d)),
        {
          kind: "details",
          rows: [
            ["Tip", money(d.amount_cents, d.currency)],
            ["From", s(d.supporter_name, "Anonymous")],
          ],
        },
        ...(s(d.supporter_message)
          ? [
              {
                kind: "quote",
                text: s(d.supporter_message),
                by: s(d.supporter_name, "Anonymous"),
              } as Block,
            ]
          : []),
        small(
          "Stripe pays tips out to your bank on your payout schedule. The supporter gets their receipt from Stripe.",
        ),
        ...testNote(d),
      ],
      button: { label: "See my tips", url: `${SITE_URL}/dashboard` },
    }),
  },
  {
    id: "tip_refunded",
    category: "billing",
    label: "Tip refunded",
    trigger: "A tip is refunded in Stripe.",
    wired: true,
    sample: {
      username: "maya",
      display_name: "Maya",
      amount_cents: 1000,
      refunded_cents: 1000,
      currency: "usd",
      supporter_name: "Sam",
    },
    build: (d) => ({
      subject: "A tip on Yooits.me was refunded",
      preheader: `${money(d.refunded_cents, d.currency)} went back to the supporter.`,
      heading: "A tip was refunded",
      blocks: [
        p(hi(d)),
        {
          kind: "details",
          rows: [
            ["Original tip", money(d.amount_cents, d.currency)],
            ["Refunded", money(d.refunded_cents, d.currency)],
            ["From", s(d.supporter_name, "Anonymous")],
          ],
        },
        small("Stripe has sent the supporter their refund receipt."),
        ...testNote(d),
      ],
      button: { label: "See my tips", url: `${SITE_URL}/dashboard` },
    }),
  },
  {
    id: "tip_disputed",
    category: "billing",
    label: "Tip disputed",
    trigger: "A supporter's bank opens a dispute on a tip.",
    wired: true,
    sample: {
      username: "maya",
      display_name: "Maya",
      amount_cents: 1000,
      currency: "usd",
      dispute_amount_cents: 1050,
    },
    build: (d) => ({
      subject: "A tip on Yooits.me is being disputed",
      preheader: "The supporter's bank has questioned a payment.",
      heading: "A tip is being disputed",
      blocks: [
        p(hi(d)),
        p(
          `A supporter's bank has opened a dispute on a ${money(d.amount_cents, d.currency)} tip. Stripe may hold the amount while it's reviewed.`,
        ),
        p(
          "We're looking into it and will contact you if we need anything. You don't need to do anything right now.",
        ),
        ...testNote(d),
      ],
    }),
  },
  {
    id: "tips_approved",
    category: "billing",
    label: "Tips approved",
    trigger: "An admin approves a creator for tipping.",
    wired: true,
    sample: { username: "maya", display_name: "Maya" },
    build: (d) => ({
      subject: "You're approved for tips on Yooits.me",
      preheader: "Your tip button can go live once Stripe is set up.",
      heading: "You're approved for tips",
      blocks: [
        p(hi(d)),
        p(
          "We've approved your page for tips. Once your Stripe payouts are set up, supporters can tip you from your page.",
        ),
      ],
      button: { label: "Set up tips", url: `${SITE_URL}/dashboard` },
    }),
  },
  {
    id: "tips_paused",
    category: "billing",
    label: "Tips paused",
    trigger: "An admin pauses tips for a creator.",
    wired: true,
    sample: { username: "maya", display_name: "Maya" },
    build: (d) => ({
      subject: "Tips on your Yooits.me page are paused",
      preheader: "Supporters can't tip you right now.",
      heading: "Tips are paused",
      blocks: [
        p(hi(d)),
        p(
          "We've paused tips on your page while we review your account. Tips you've already received aren't affected.",
        ),
        p("Reply to this email if you have questions."),
      ],
    }),
  },
  {
    id: "payouts_ready",
    category: "billing",
    label: "Payouts ready",
    trigger: "Stripe confirms a creator can take payments and receive payouts.",
    wired: true,
    sample: { username: "maya", display_name: "Maya" },
    build: (d) => ({
      subject: "Your Stripe payouts are set up",
      preheader: "Stripe has verified your account for tips.",
      heading: "Payouts are ready",
      blocks: [
        p(hi(d)),
        p("Stripe has finished setting up your account, so tips can be paid out to your bank."),
      ],
      button: { label: "Open my dashboard", url: `${SITE_URL}/dashboard` },
    }),
  },

  // Messages ----------------------------------------------------------------
  {
    id: "dm_request",
    category: "messages",
    label: "New message request",
    trigger: "Someone sends a first message (a request) to a person.",
    wired: true,
    sample: {
      username: "maya",
      display_name: "Maya",
      from_username: "sam",
      from_display_name: "Sam",
    },
    build: (d) => ({
      subject: `${s(d.from_display_name, "Someone")} wants to message you on Yooits.me`,
      preheader: "Accept or decline the request in Messages.",
      heading: "You have a message request",
      blocks: [
        p(hi(d)),
        p(
          `**${s(d.from_display_name, "Someone")}** (@${s(d.from_username)}) sent you a message request. You decide whether to accept it.`,
        ),
        small(
          "For your safety we never put message text in email. If something feels wrong, you can block or report from the conversation.",
        ),
      ],
      button: { label: "View request", url: `${SITE_URL}/messages` },
    }),
  },
  {
    id: "dm_message",
    category: "messages",
    label: "New message",
    trigger:
      "A new message in an accepted conversation (at most one email per conversation every 3 hours, none while reading).",
    wired: true,
    sample: {
      username: "maya",
      display_name: "Maya",
      from_username: "sam",
      from_display_name: "Sam",
      conversation_id: "00000000-0000-0000-0000-000000000000",
    },
    build: (d) => ({
      subject: `New message from ${s(d.from_display_name, "someone")} on Yooits.me`,
      preheader: "Open Messages to read it.",
      heading: `${s(d.from_display_name, "Someone")} sent you a message`,
      blocks: [
        p(hi(d)),
        p(
          `You have a new message from **${s(d.from_display_name, "someone")}** (@${s(d.from_username)}).`,
        ),
      ],
      button: {
        label: "Read message",
        url: s(d.conversation_id)
          ? `${SITE_URL}/messages/${encodeURIComponent(s(d.conversation_id))}`
          : `${SITE_URL}/messages`,
      },
    }),
  },

  // Activity ----------------------------------------------------------------
  {
    id: "wishlist_live",
    category: "activity",
    label: "Wishlist is public",
    trigger: "A wishlist is made public for the first time.",
    wired: true,
    sample: {
      username: "maya",
      display_name: "Maya",
      wishlist_title: "Birthday",
      wishlist_slug: "birthday",
    },
    build: (d) => {
      const url = `${SITE_URL}/${encodeURIComponent(s(d.username))}/wishlist/${encodeURIComponent(s(d.wishlist_slug))}`;
      return {
        subject: `Your "${s(d.wishlist_title, "wishlist")}" wishlist is ready to share`,
        preheader: "Here's the link to send to friends and family.",
        heading: "Your wishlist is ready to share",
        blocks: [
          p(hi(d)),
          p(
            `**${s(d.wishlist_title, "Your wishlist")}** is public. Anyone with the link can see it.`,
          ),
          { kind: "details", rows: [["Share link", url.replace(/^https:\/\//, "")]] },
        ],
        button: { label: "View my wishlist", url },
      };
    },
  },
  {
    id: "reward_unlocked",
    category: "activity",
    label: "Reward unlocked",
    trigger: "A reward or theme is unlocked. Sent once the rewards feature is on main.",
    wired: false,
    sample: {
      username: "maya",
      display_name: "Maya",
      reward_name: "Aurora theme",
      reward_detail: "for adding 5 links",
    },
    build: (d) => ({
      subject: `You unlocked ${s(d.reward_name, "a reward")} on Yooits.me`,
      preheader: "It's ready to use on your page.",
      heading: `You unlocked ${s(d.reward_name, "a reward")}`,
      blocks: [
        p(hi(d)),
        p(
          `Nice work${s(d.reward_detail) ? `: you unlocked **${s(d.reward_name)}** ${s(d.reward_detail)}` : ""}. It's waiting in your dashboard.`,
        ),
      ],
      button: { label: "Use it now", url: `${SITE_URL}/dashboard` },
    }),
  },
  {
    id: "referral_joined",
    category: "activity",
    label: "Referral joined",
    trigger: "Someone you invited joins. Ready for when referrals launch; nothing sends it yet.",
    wired: false,
    sample: { username: "maya", display_name: "Maya", friend_username: "sam" },
    build: (d) => ({
      subject: `@${s(d.friend_username, "a friend")} joined Yooits.me with your invite`,
      preheader: "Thanks for spreading the word.",
      heading: "Your invite worked",
      blocks: [
        p(hi(d)),
        p(
          `**@${s(d.friend_username)}** just joined Yooits.me with your invite. Thanks for spreading the word.`,
        ),
      ],
      button: {
        label: "Visit their page",
        url: `${SITE_URL}/${encodeURIComponent(s(d.friend_username))}`,
      },
    }),
  },

  // Marketing ---------------------------------------------------------------
  {
    id: "announcement",
    category: "marketing",
    label: "Announcement",
    trigger: "Written and sent from the Owner Console to people who opted in to news.",
    wired: true,
    sample: {
      username: "maya",
      display_name: "Maya",
      subject: "New on Yooits.me: seasonal themes",
      heading: "Seasonal themes are here",
      body: "Give your page a winter look with three new seasonal themes, free for everyone this month.\n\nOpen your dashboard and pick one under Themes.",
      button_label: "Pick a theme",
      button_url: "https://yooits.me/dashboard",
    },
    build: (d) => ({
      subject: s(d.subject, "News from Yooits.me"),
      preheader: s(d.preheader, s(d.body).split("\n")[0].slice(0, 120)),
      heading: s(d.heading, s(d.subject, "News from Yooits.me")),
      blocks: s(d.body)
        .split(/\n{2,}/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => p(t)),
      button:
        s(d.button_label) && s(d.button_url)
          ? { label: s(d.button_label), url: s(d.button_url) }
          : undefined,
    }),
  },
  {
    id: "founding_invite",
    category: "marketing",
    label: "Founding Member invite",
    trigger: "Prepared for the Founding Member campaign. Not sent until the owner says so.",
    wired: false,
    sample: { invitee_name: "Maya", code: "FOUNDER-ABCD", expires_at: "2026-12-15T00:00:00Z" },
    build: (d) => ({
      subject: "You're invited to be a Yooits.me Founding Member",
      preheader: "3 months of Yooits.me Plus free. No card needed.",
      heading: "Be one of the first 50",
      blocks: [
        p(`Hi ${s(d.invitee_name, "there")},`),
        p(
          "We're opening Yooits.me to 50 Founding Members. You'd get 3 months of Yooits.me Plus free, with no card and no auto-renewal, and a direct line to shape what we build next.",
        ),
        { kind: "code", text: s(d.code, "YOUR-CODE") },
        ...(day(d.expires_at) ? [small(`This invite works until ${day(d.expires_at)}.`)] : []),
      ],
      button: {
        label: "Claim my spot",
        url: `${SITE_URL}/auth?invite=${encodeURIComponent(s(d.code))}`,
      },
    }),
  },

  // Owner alerts ------------------------------------------------------------
  {
    id: "admin_new_report",
    category: "admin",
    label: "New report (owner)",
    trigger: "Anyone reports a page, wishlist or message.",
    wired: true,
    sample: {
      report_id: "00000000-0000-0000-0000-000000000000",
      target_kind: "profile",
      target_username: "spammy",
      reason: "scam",
    },
    build: (d) => ({
      subject: `New report: ${reasonLabel(d.reason)} (${kindLabel(d.target_kind)})`,
      preheader: s(d.target_username)
        ? `About @${s(d.target_username)}.`
        : "Review it in the Owner Console.",
      heading: "New report to review",
      blocks: [
        {
          kind: "details",
          rows: [
            ["About", s(d.target_username) ? `@${s(d.target_username)}` : "Unknown"],
            ["What", kindLabel(d.target_kind)],
            ["Reason", reasonLabel(d.reason)],
          ],
        },
      ],
      button: { label: "Open Reports", url: `${SITE_URL}/owner/reports` },
    }),
  },
  {
    id: "admin_new_feedback",
    category: "admin",
    label: "Founding Member feedback (owner)",
    trigger: "A Founding Member sends feedback from their dashboard.",
    wired: true,
    sample: {
      username: "maya",
      rating: 5,
      message: "Love the themes. Can I reorder links by dragging?",
    },
    build: (d) => ({
      subject: `Feedback from @${s(d.username, "a member")}${typeof d.rating === "number" ? ` (${d.rating}/5)` : ""}`,
      preheader: s(d.message).slice(0, 120),
      heading: "New Founding Member feedback",
      blocks: [
        {
          kind: "quote",
          text: s(d.message),
          by: `@${s(d.username)}${typeof d.rating === "number" ? `, ${d.rating}/5` : ""}`,
        },
      ],
      button: { label: "Open Founding Members", url: `${SITE_URL}/owner/founding` },
    }),
  },
  {
    id: "admin_dispute",
    category: "admin",
    label: "Tip dispute (owner)",
    trigger: "A supporter's bank disputes a tip.",
    wired: true,
    sample: {
      username: "maya",
      amount_cents: 1000,
      currency: "usd",
      dispute_amount_cents: 1050,
      dispute_status: "needs_response",
      livemode: true,
    },
    build: (d) => ({
      subject: `Tip dispute on @${s(d.username)}: ${money(d.dispute_amount_cents ?? d.amount_cents, d.currency)}`,
      preheader: "Respond in Stripe before the deadline.",
      heading: "A tip is disputed",
      blocks: [
        {
          kind: "details",
          rows: [
            ["Creator", `@${s(d.username)}`],
            ["Tip", money(d.amount_cents, d.currency)],
            ["Disputed", money(d.dispute_amount_cents, d.currency)],
            ["Status", s(d.dispute_status)],
          ],
        },
        p("Respond to the dispute in the Stripe Dashboard before its deadline."),
        ...testNote(d),
      ],
      button: { label: "Open Money", url: `${SITE_URL}/owner/revenue` },
    }),
  },
];

function kindLabel(k: unknown): string {
  return k === "wishlist" ? "A wishlist" : k === "message" ? "A message" : "A page";
}
function reasonLabel(r: unknown): string {
  const m: Record<string, string> = {
    spam: "Spam",
    scam: "Scam or fraud",
    impersonation: "Impersonation",
    harassment: "Harassment",
    sexual_content: "Sexual content",
    illegal: "Illegal content",
    other: "Something else",
  };
  return m[s(r)] ?? "Something else";
}

export const TEMPLATE_BY_ID: Record<string, TemplateDef> = Object.fromEntries(
  TEMPLATES.map((t) => [t.id, t]),
);
