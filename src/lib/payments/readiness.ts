/**
 * Which payment features are ready to switch on, and what each still needs.
 * Pure, so it can be tested; Owner > Payments shows the result.
 */
import type { KeyMode, WebhookItem } from "./stripe-setup";

export type FeatureInputs = {
  keyMode: KeyMode | null;
  /** Stripe says the account can take payments. */
  accountReady: boolean;
  connectOk: boolean;
  plusPriceOk: boolean;
  portalOk: boolean;
  webhookOk: Partial<Record<WebhookItem, boolean>>;
  env: {
    PLUS_BILLING_ENABLED: boolean;
    PLUS_CHECKOUT_ENABLED: boolean;
    /** PLUS_CHECKOUT_ENABLED=owner: only Yooits admins can buy. */
    PLUS_CHECKOUT_OWNER_ONLY?: boolean;
    PLUS_LIVE_MODE_APPROVED: boolean;
    TIPPING_ENABLED: boolean;
    STRIPE_LIVE_MODE_APPROVED: boolean;
  };
  settings: {
    creatorSubs: { enabled: boolean; checkout: boolean };
    gifts: { enabled: boolean; checkout: boolean };
    offerings: { enabled: boolean; checkout: boolean };
  };
};

export type FeatureState = {
  id: "plus" | "tips" | "creator_subscriptions" | "gift_money" | "support_offerings";
  label: string;
  on: boolean;
  /** Everything is in place except the switch itself. */
  ready: boolean;
  missing: string[];
  toTurnOn: string[];
  /** On for the owner's account only. */
  ownerOnly?: boolean;
};

export function featureReadiness(i: FeatureInputs): FeatureState[] {
  const live = i.keyMode === "live";
  const base: string[] = [];
  if (!i.keyMode) base.push("A Stripe secret key on this site.");
  else if (!i.accountReady) base.push("Stripe to finish activating the account (charges enabled).");

  const plusMissing = [...base];
  if (i.keyMode && !i.plusPriceOk) plusMissing.push("The Plus price in Stripe (Set up makes it).");
  if (i.keyMode && !i.portalOk) plusMissing.push("Billing portal settings (Set up makes them).");
  if (i.keyMode && !i.webhookOk.billing_webhook)
    plusMissing.push("The Plus billing webhook (Set up makes it).");
  const plusBase = i.env.PLUS_BILLING_ENABLED && (!live || i.env.PLUS_LIVE_MODE_APPROVED);
  const plusOn = plusBase && i.env.PLUS_CHECKOUT_ENABLED;
  const plusOwnerOnly = plusBase && !plusOn && !!i.env.PLUS_CHECKOUT_OWNER_ONLY;

  const connectMissing = [...base];
  if (i.keyMode && !i.connectOk)
    connectMissing.push("Stripe Connect on the account, for paying creators.");
  if (i.keyMode && !i.webhookOk.connect_webhook)
    connectMissing.push("The creator payments webhook (Set up makes it).");
  const tipsMissing = [...connectMissing];
  if (i.keyMode && !i.webhookOk.payments_webhook)
    tipsMissing.push("The tip fees webhook (Set up makes it).");
  const tipsOn = i.env.TIPPING_ENABLED && (!live || i.env.STRIPE_LIVE_MODE_APPROVED);

  const tipSwitches = live ? ["TIPPING_ENABLED", "STRIPE_LIVE_MODE_APPROVED"] : ["TIPPING_ENABLED"];
  const plusSwitches = live
    ? ["PLUS_BILLING_ENABLED", "PLUS_CHECKOUT_ENABLED", "PLUS_LIVE_MODE_APPROVED"]
    : ["PLUS_BILLING_ENABLED", "PLUS_CHECKOUT_ENABLED"];
  const vercel = (names: string[]) => `Set ${names.join(", ")} to true in Vercel and redeploy.`;

  return [
    {
      id: "plus",
      label: "Yooits Plus ($4.99 a month)",
      on: plusOn,
      ready: plusMissing.length === 0,
      missing: plusMissing,
      toTurnOn: plusOn ? [] : [vercel(plusSwitches)],
      ownerOnly: plusOwnerOnly,
    },
    {
      id: "tips",
      label: "Tips ($0.50 fee)",
      on: tipsOn,
      ready: tipsMissing.length === 0,
      missing: tipsMissing,
      toTurnOn: tipsOn ? [] : [vercel(tipSwitches)],
    },
    {
      id: "creator_subscriptions",
      label: "Creator subscriptions",
      on: tipsOn && i.settings.creatorSubs.enabled && i.settings.creatorSubs.checkout,
      ready: connectMissing.length === 0,
      missing: connectMissing,
      toTurnOn: [
        ...(tipsOn ? [] : [`${vercel(tipSwitches)} (creator subscriptions use the tips switch).`]),
        ...(i.settings.creatorSubs.enabled && i.settings.creatorSubs.checkout
          ? []
          : ["Turn on subscriptions and checkout in Owner > Creators."]),
      ],
    },
    {
      id: "gift_money",
      label: "Wishlist gift money",
      on: i.settings.gifts.enabled && i.settings.gifts.checkout,
      ready: false,
      missing: ["Stripe's written approval for gift money, then a checkout (not built)."],
      toTurnOn: [],
    },
    {
      id: "support_offerings",
      label: "Support Offerings",
      on: i.settings.offerings.enabled && i.settings.offerings.checkout,
      ready: false,
      missing: ["A checkout and paid delivery (not built), then approval rules met."],
      toTurnOn: [],
    },
  ];
}
