import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { canAcceptTips, snapshotAccount } from "./account-status";
import { buildTipCheckoutParams } from "./checkout-params";
import { isLiveKey, isTestKey } from "./config.server";
import {
  CREATOR_TYPES,
  OFFERING_MAX,
  stripeProductDescription,
  type EligibilityInput,
  tipEligibility,
} from "./eligibility";
import {
  formatUsd,
  MAX_TIP_CENTS,
  parseDollarsToCents,
  PLATFORM_FEE_CENTS,
  quoteTip,
  SUGGESTED_TIP_CENTS,
} from "./money";
import { verifyStripeWebhook } from "./verify-webhook";

describe("tip amounts", () => {
  it("adds a flat $0.50 fee on top and never reduces the tip", () => {
    for (const tip of [...SUGGESTED_TIP_CENTS, 501, 1234, MAX_TIP_CENTS]) {
      const q = quoteTip(tip);
      expect(q.ok).toBe(true);
      if (!q.ok) continue;
      expect(q.quote.tipCents).toBe(tip);
      expect(q.quote.feeCents).toBe(50);
      expect(q.quote.totalCents).toBe(tip + 50);
    }
    expect(PLATFORM_FEE_CENTS).toBe(50);
  });

  it("matches Chris's worked example: $10 tip -> $10.50 charged, $0.50 to Yooits", () => {
    const q = quoteTip(1000);
    expect(q).toEqual({ ok: true, quote: { tipCents: 1000, feeCents: 50, totalCents: 1050 } });
  });

  it("enforces the $5 minimum and the $500 cap", () => {
    expect(quoteTip(499).ok).toBe(false);
    expect(quoteTip(0).ok).toBe(false);
    expect(quoteTip(-1000).ok).toBe(false);
    expect(quoteTip(500).ok).toBe(true);
    expect(quoteTip(MAX_TIP_CENTS + 1).ok).toBe(false);
  });

  it("rejects anything that isn't a whole number of cents", () => {
    for (const bad of [10.5, Number.NaN, Number.POSITIVE_INFINITY, "1000", null, undefined, {}]) {
      expect(quoteTip(bad as unknown).ok).toBe(false);
    }
  });

  it("parses typed dollar amounts", () => {
    expect(parseDollarsToCents("10")).toBe(1000);
    expect(parseDollarsToCents("$12.5")).toBe(1250);
    expect(parseDollarsToCents(" 7.05 ")).toBe(705);
    expect(parseDollarsToCents("1,000")).toBe(100000);
    for (const bad of ["", "abc", "1.234", "-5", "5e3", "0x10", "1.2.3"]) {
      expect(parseDollarsToCents(bad)).toBeNull();
    }
  });

  it("formats money", () => {
    expect(formatUsd(1050)).toBe("$10.50");
    expect(formatUsd(5)).toBe("$0.05");
    expect(formatUsd(123456)).toBe("$1,234.56");
  });
});

describe("Stripe checkout parameters", () => {
  const params = buildTipCheckoutParams({
    tipId: "11111111-1111-4111-8111-111111111111",
    creatorUserId: "22222222-2222-4222-8222-222222222222",
    handle: "maya",
    quote: { tipCents: 1000, feeCents: 50, totalCents: 1050 },
    baseUrl: "https://yooits.me",
    now: 1_700_000_000_000,
  });

  it("charges tip + service fee as two visible line items", () => {
    const items = params.line_items!;
    expect(items).toHaveLength(2);
    expect(items[0].price_data?.unit_amount).toBe(1000);
    expect(items[1].price_data?.unit_amount).toBe(50);
    expect(items[1].price_data?.product_data?.name).toBe("Yooits service fee");
    const total = items.reduce(
      (s, i) => s + (i.price_data?.unit_amount ?? 0) * (i.quantity ?? 0),
      0,
    );
    expect(total).toBe(1050);
    expect(items.every((i) => i.price_data?.currency === "usd")).toBe(true);
  });

  it("takes exactly the $0.50 as the application fee", () => {
    expect(params.payment_intent_data?.application_fee_amount).toBe(50);
    expect(params.mode).toBe("payment");
  });

  it("links the session back to the tip and expires after Stripe's 30-minute minimum", () => {
    expect(params.metadata?.yooits_tip_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(params.payment_intent_data?.metadata?.yooits_tip_id).toBe(
      params.metadata?.yooits_tip_id,
    );
    expect(params.expires_at! - 1_700_000_000).toBeGreaterThan(30 * 60);
    expect(params.success_url).toBe(
      "https://yooits.me/maya/tip?status=success&session_id={CHECKOUT_SESSION_ID}",
    );
    expect(params.cancel_url).toBe("https://yooits.me/maya/tip?status=cancelled");
  });
});

describe("connected account status", () => {
  it("is pending before onboarding is submitted", () => {
    expect(snapshotAccount({ id: "acct_1", details_submitted: false }).status).toBe("pending");
  });
  it("is restricted when Stripe disables charges", () => {
    const s = snapshotAccount({
      id: "acct_1",
      details_submitted: true,
      charges_enabled: false,
      requirements: {
        disabled_reason: "requirements.past_due",
        past_due: ["individual.ssn_last_4"],
      },
    });
    expect(s.status).toBe("restricted");
    expect(s.requirements_due_count).toBe(1);
  });
  it("is connected only when charges are enabled and nothing disables it", () => {
    const s = snapshotAccount({ id: "acct_1", details_submitted: true, charges_enabled: true });
    expect(s.status).toBe("connected");
    expect(canAcceptTips(s)).toBe(true);
    expect(canAcceptTips({ status: "connected", charges_enabled: false })).toBe(false);
    expect(canAcceptTips({ status: "disconnected", charges_enabled: true })).toBe(false);
    expect(canAcceptTips(null)).toBe(false);
  });
});

describe("live-mode guard", () => {
  it("recognises test and live keys", () => {
    expect(isTestKey("sk_test_abc")).toBe(true);
    expect(isTestKey("rk_test_abc")).toBe(true);
    expect(isLiveKey("sk_live_abc")).toBe(true);
    expect(isLiveKey("sk_test_abc")).toBe(false);
  });
});

describe("webhook signature verification", () => {
  const stripe = new Stripe("sk_test_dummy_for_signing_only", {
    httpClient: Stripe.createFetchHttpClient(),
  });
  const platformSecret = "whsec_platform_test";
  const connectSecret = "whsec_connect_test";
  const payload = JSON.stringify({
    id: "evt_test_1",
    object: "event",
    type: "checkout.session.completed",
    account: "acct_123",
    livemode: false,
    data: { object: { id: "cs_test_1" } },
  });

  const sign = (secret: string, body = payload) =>
    stripe.webhooks.generateTestHeaderStringAsync({ payload: body, secret });

  it("accepts events signed by either endpoint's secret", async () => {
    for (const secret of [platformSecret, connectSecret]) {
      const event = await verifyStripeWebhook(stripe, payload, await sign(secret), [
        platformSecret,
        connectSecret,
      ]);
      expect(event?.id).toBe("evt_test_1");
    }
  });

  it("rejects a wrong secret, a tampered body and a missing header", async () => {
    const secrets = [platformSecret, connectSecret];
    expect(
      await verifyStripeWebhook(stripe, payload, await sign("whsec_other"), secrets),
    ).toBeNull();
    const tampered = payload.replace("acct_123", "acct_evil");
    expect(
      await verifyStripeWebhook(stripe, tampered, await sign(platformSecret), secrets),
    ).toBeNull();
    expect(await verifyStripeWebhook(stripe, payload, null, secrets)).toBeNull();
    expect(await verifyStripeWebhook(stripe, payload, await sign(platformSecret), [])).toBeNull();
  });

  it("rejects stale signatures (replay protection)", async () => {
    const old = await stripe.webhooks.generateTestHeaderStringAsync({
      payload,
      secret: platformSecret,
      timestamp: Math.floor(Date.now() / 1000) - 60 * 60,
    });
    expect(await verifyStripeWebhook(stripe, payload, old, [platformSecret])).toBeNull();
  });
});

describe("who can receive tips", () => {
  const ok: EligibilityInput = {
    creatorType: "artist",
    offering: "Original songs I post every week",
    attestedAt: "2026-11-18T00:00:00Z",
    publicLinkCount: 2,
    suspended: false,
  };

  it("accepts a creator who says what they offer, confirms it and links their work", () => {
    expect(tipEligibility(ok)).toEqual({ ok: true });
  });

  it("refuses everyday profiles that haven't described content or a service", () => {
    expect(
      tipEligibility({
        creatorType: null,
        offering: null,
        attestedAt: null,
        publicLinkCount: 0,
        suspended: false,
      }),
    ).toEqual({
      ok: false,
      problems: ["creator_type", "offering", "attestation", "public_link"],
    });
  });

  it("checks each requirement on its own", () => {
    const problems = (over: Partial<EligibilityInput>) => {
      const r = tipEligibility({ ...ok, ...over });
      return r.ok ? [] : r.problems;
    };
    expect(problems({ creatorType: "friend" })).toEqual(["creator_type"]);
    expect(problems({ offering: "  money  " })).toEqual(["offering"]);
    expect(problems({ offering: "x".repeat(OFFERING_MAX + 1) })).toEqual(["offering"]);
    expect(problems({ attestedAt: null })).toEqual(["attestation"]);
    expect(problems({ publicLinkCount: 0 })).toEqual(["public_link"]);
    expect(problems({ suspended: true })).toEqual(["suspended"]);
  });

  it("describes the business to Stripe from what the creator said", () => {
    expect(stripeProductDescription("artist", " Original songs ")).toBe(
      "Tips from supporters via Yooits. Artist or musician: Original songs",
    );
    expect(CREATOR_TYPES.map((t) => t.value)).toEqual([
      "content_creator",
      "artist",
      "writer",
      "educator",
      "service_provider",
    ]);
  });
});
