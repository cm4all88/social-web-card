/**
 * The Yooits look for email, taken from the site itself: the colours are
 * src/styles.css's :root tokens (oklch converted to hex, since email clients
 * don't read oklch), the logo is public/yooits-logo.png resized, and the type
 * is the same system font stack the site uses.
 */
import { LEGAL_DETAILS } from "@/lib/legal/documents";

export const SITE_URL = "https://yooits.me";

export const BRAND = {
  name: LEGAL_DETAILS.brand,
  site: LEGAL_DETAILS.site,
  operator: LEGAL_DETAILS.operator,
  contact: LEGAL_DETAILS.contact,
  // public/email/yooits-logo.png: the site logo at 192px wide, shown at 96px.
  logoUrl: `${SITE_URL}/email/yooits-logo.png`,
  logoWidth: 96,
  logoHeight: 82,
  colors: {
    background: "#2e304c", // --background oklch(0.32 0.05 280)
    card: "#3f3e5f", // --card
    foreground: "#fbfbff", // --foreground
    mutedForeground: "#c0c3d5", // --muted-foreground
    primary: "#df6df8", // --primary oklch(0.72 0.22 320)
    primaryForeground: "#0e0f23", // --primary-foreground
    accent: "#eb53c2", // --accent
    gradientFrom: "#914dff", // --gradient-hero stops
    gradientVia: "#eb53c2",
    gradientTo: "#ff6853",
    // The message body sits on white so it reads well in every client,
    // including ones that force light mode; text uses the site's ink colour.
    paper: "#ffffff",
    ink: "#0e0f23",
    inkMuted: "#5b5d78",
    rule: "#e7e6f2",
    danger: "#e7000b",
  },
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
} as const;

/**
 * Postal address for marketing email footers (US CAN-SPAM requires one in
 * commercial email). Not set yet: marketing email can't be sent until it is.
 * Account, security and billing email doesn't need it.
 */
export const MAILING_ADDRESS: string | null = null;

/** Sender addresses on the verified yooits.me domain in Resend. */
export const SENDERS = {
  // Account, security and billing: the same sender Supabase's sign-in emails use.
  account: `${BRAND.name} <no-reply@yooits.me>`,
  notifications: `${BRAND.name} <notifications@yooits.me>`,
  news: `${BRAND.name} <news@yooits.me>`,
  admin: `${BRAND.name} alerts <alerts@yooits.me>`,
} as const;

/** Replies go to a mailbox someone reads. */
export const REPLY_TO = LEGAL_DETAILS.contact;
