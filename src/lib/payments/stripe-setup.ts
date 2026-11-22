/**
 * What Yooits needs in a Stripe account, worked out without any network so it
 * can be tested on its own. The owner's Payments page (Owner > Payments) uses
 * this to set up a Stripe account from its secret key: the webhook endpoints
 * and the Plus billing portal. Setting up turns nothing on: every payment
 * feature keeps its own switch.
 */
import { SUBSCRIPTION_EVENTS } from "@/lib/billing/sync";

export type SetupItem =
  "billing_webhook" | "payments_webhook" | "connect_webhook" | "portal_configuration";
export type WebhookItem = Exclude<SetupItem, "portal_configuration">;

/** Hosts a webhook may point at. Anything else (a protected preview URL, say) is refused. */
export const WEBHOOK_HOSTS = ["yooits.me", "test.yooits.me"] as const;

export type WebhookPlan = {
  item: WebhookItem;
  label: string;
  /** Events on connected accounts (creators' Stripe accounts) rather than Yooits' own. */
  connect: boolean;
  path: string;
  events: string[];
  /** The Vercel variable that can hold this endpoint's signing secret instead. */
  envSecret: string;
};

/** Yooits Plus: subscriptions on Yooits' own Stripe account. */
export const BILLING_WEBHOOK_EVENTS: string[] = [...SUBSCRIPTION_EVENTS];

/** Tips: Yooits' fee on each tip, which Stripe reports on Yooits' own account. */
export const PAYMENTS_WEBHOOK_EVENTS: string[] = [
  "application_fee.created",
  "application_fee.refunded",
];

/** Tips and creator subscriptions: payments on creators' connected accounts. */
export const CONNECT_WEBHOOK_EVENTS: string[] = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "charge.succeeded",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
  "account.updated",
  "account.application.deauthorized",
];

export const WEBHOOK_PLANS: WebhookPlan[] = [
  {
    item: "billing_webhook",
    label: "Yooits Plus billing",
    connect: false,
    path: "/api/stripe/billing-webhook",
    events: BILLING_WEBHOOK_EVENTS,
    envSecret: "STRIPE_BILLING_WEBHOOK_SECRET",
  },
  {
    item: "payments_webhook",
    label: "Tip fees",
    connect: false,
    path: "/api/stripe/webhook",
    events: PAYMENTS_WEBHOOK_EVENTS,
    envSecret: "STRIPE_WEBHOOK_SECRET",
  },
  {
    item: "connect_webhook",
    label: "Creator payments (tips and subscriptions)",
    connect: true,
    path: "/api/stripe/webhook",
    events: CONNECT_WEBHOOK_EVENTS,
    envSecret: "STRIPE_CONNECT_WEBHOOK_SECRET",
  },
];

/** Webhooks Set up handles now. Tips and Connect wait until those features are switched on. */
export const SETUP_WEBHOOKS: WebhookItem[] = ["billing_webhook"];

/** The site the endpoints point at, or null when the address isn't one of Yooits' own. */
export function webhookBase(siteUrl: string | null | undefined): string | null {
  if (!siteUrl) return null;
  let u: URL;
  try {
    u = new URL(siteUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (!(WEBHOOK_HOSTS as readonly string[]).includes(u.hostname)) return null;
  return `https://${u.hostname}`;
}

/** Events the endpoint should have and doesn't. */
export function missingEvents(have: string[], want: string[]): string[] {
  if (have.includes("*")) return [];
  return want.filter((e) => !have.includes(e));
}

/** Stripe's billing portal for Plus: card, invoices and cancelling at the end of the month. */
export function portalConfigurationParams(base: string) {
  return {
    business_profile: {
      headline: "Manage your Yooits Plus subscription",
      privacy_policy_url: `${base}/privacy`,
      terms_of_service_url: `${base}/terms`,
    },
    default_return_url: `${base}/dashboard#plus`,
    features: {
      customer_update: { enabled: true, allowed_updates: ["email"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        proration_behavior: "none",
        cancellation_reason: {
          enabled: true,
          options: ["too_expensive", "unused", "missing_features", "other"],
        },
      },
      subscription_update: { enabled: false },
    },
    metadata: { yooits_setup: "portal_configuration" },
  } as const;
}

export type KeyMode = "live" | "test";
export function keyMode(key: string | null | undefined): KeyMode | null {
  if (!key) return null;
  if (/^(sk|rk)_live_/.test(key)) return "live";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  return null;
}

// ---------------------------------------------------------------------------
// Reusing what the Stripe account already has
// ---------------------------------------------------------------------------
type PriceCandidate = {
  id: string;
  created: number;
  lookup_key?: string | null;
  metadata?: Record<string, string> | null;
  product:
    | string
    | {
        id: string;
        name?: string | null;
        active?: boolean | null;
        metadata?: Record<string, string> | null;
        deleted?: unknown;
      };
};

/**
 * Of the account's active $4.99-a-month USD prices (already checked by the
 * caller), the one that is Yooits Plus: marked as ours first, then one whose
 * product is called Plus. Oldest wins, so running again picks the same one.
 * Null when none of them is plainly Plus.
 */
export function choosePlusPrice<T extends PriceCandidate>(prices: T[]): T | null {
  const product = (p: T) => (typeof p.product === "string" ? null : p.product);
  const usable = prices.filter((p) => {
    const pr = product(p);
    return !pr || (!pr.deleted && pr.active !== false);
  });
  const ours = (p: T) =>
    p.metadata?.yooits_product === "plus" || product(p)?.metadata?.yooits_product === "plus";
  const named = (p: T) => /\bplus\b/i.test(product(p)?.name ?? "");
  const oldest = (xs: T[]) => [...xs].sort((a, b) => a.created - b.created)[0] ?? null;
  return oldest(usable.filter(ours)) ?? oldest(usable.filter(named));
}

type EndpointLike = {
  id: string;
  url: string;
  status: string;
  metadata?: Record<string, string> | null;
};

/** An endpoint already pointing at this plan's address on any Yooits host. */
export function endpointsForPlan<T extends EndpointLike>(
  endpoints: T[],
  plan: Pick<WebhookPlan, "path">,
): T[] {
  return endpoints.filter((e) => {
    try {
      const u = new URL(e.url);
      return (WEBHOOK_HOSTS as readonly string[]).includes(u.hostname) && u.pathname === plan.path;
    } catch {
      return false;
    }
  });
}

/**
 * Who may start a Plus checkout. PLUS_CHECKOUT_ENABLED "true" opens it to
 * everyone; "owner" only to Yooits admins, for a first live purchase.
 */
export type PlusCheckoutMode = "everyone" | "owner" | "off";
export function plusCheckoutMode(value: string | null | undefined): PlusCheckoutMode {
  const v = value?.trim().toLowerCase();
  if (v === "true") return "everyone";
  if (v === "owner") return "owner";
  return "off";
}
