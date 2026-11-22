import { describe, expect, it } from "vitest";
import { creatorFeeBreakdown, formatCents, parseFeeRates, type FeeRates } from "./fees";

const rates: FeeRates = {
  yooits_percent_bps: 0,
  yooits_fixed_cents: 30,
  stripe_percent_bps: 290,
  stripe_fixed_cents: 30,
};

const processing = (total: number, r: FeeRates) =>
  Math.round((total * r.stripe_percent_bps) / 10_000) + r.stripe_fixed_cents;

describe("creatorFeeBreakdown", () => {
  it("gives the creator their whole price and adds the fee on top", () => {
    const b = creatorFeeBreakdown(500, rates)!;
    expect(b.creatorPrice).toBe(500);
    expect(b.total).toBe(b.creatorPrice + b.serviceFee);
    expect(b.total - b.estimatedProcessingFee - b.creatorPrice).toBe(b.yooitsNet);
    expect(b.yooitsNet).toBeGreaterThanOrEqual(30);
  });

  it("finds the smallest total that covers both shares, for many prices", () => {
    const pctRates = { ...rates, yooits_percent_bps: 500 };
    for (let price = 100; price <= 50_000; price += 37) {
      for (const r of [rates, pctRates]) {
        const b = creatorFeeBreakdown(price, r)!;
        const target = Math.round((price * r.yooits_percent_bps) / 10_000) + r.yooits_fixed_cents;
        expect(b.yooitsNet).toBeGreaterThanOrEqual(target);
        const less = b.total - 1;
        expect(less - processing(less, r) - price).toBeLessThan(target);
      }
    }
  });

  it("is null with no rates or a bad price", () => {
    expect(creatorFeeBreakdown(500, null)).toBeNull();
    expect(creatorFeeBreakdown(0, rates)).toBeNull();
    expect(creatorFeeBreakdown(4.5, rates)).toBeNull();
  });

  it("handles zero rates", () => {
    const b = creatorFeeBreakdown(500, {
      yooits_percent_bps: 0,
      yooits_fixed_cents: 0,
      stripe_percent_bps: 0,
      stripe_fixed_cents: 0,
    })!;
    expect(b).toMatchObject({ total: 500, serviceFee: 0, yooitsNet: 0 });
  });
});

describe("parseFeeRates", () => {
  it("accepts complete rates and rejects missing or broken ones", () => {
    expect(parseFeeRates(rates)).toEqual(rates);
    expect(parseFeeRates(null)).toBeNull();
    expect(parseFeeRates({ ...rates, stripe_fixed_cents: null })).toBeNull();
    expect(parseFeeRates({ ...rates, yooits_percent_bps: -1 })).toBeNull();
    expect(parseFeeRates({ ...rates, stripe_percent_bps: 1.5 })).toBeNull();
  });
});

it("formats cents as dollars", () => {
  expect(formatCents(123456)).toBe("$1,234.56");
  expect(formatCents(50)).toBe("$0.50");
});

// The owner's schedule (Nov 22): $0.50 for Yooits plus Stripe's card fee, both
// paid by the subscriber. Creators' connected accounts pay Stripe's fee, so the
// application fee must be yooitsNet for the creator to receive the full price.
it("gives the creator their whole price under the owner's schedule", () => {
  const owner: FeeRates = {
    yooits_percent_bps: 0,
    yooits_fixed_cents: 50,
    stripe_percent_bps: 290,
    stripe_fixed_cents: 30,
  };
  expect(creatorFeeBreakdown(500, owner)?.total).toBe(597);
  for (const price of [100, 299, 500, 999, 2500, 50_000]) {
    const b = creatorFeeBreakdown(price, owner)!;
    const creatorReceives = b.total - b.estimatedProcessingFee - b.yooitsNet;
    expect(creatorReceives).toBe(price);
    expect(b.yooitsNet).toBeGreaterThanOrEqual(50);
  }
});
