import { describe, expect, it } from "vitest";
import {
  milestoneStatus,
  nextMilestone,
  parseCreatorEarnings,
  type CreatorMilestone,
} from "./earnings";

const m = (
  key: string,
  threshold: number,
  extra: Partial<CreatorMilestone> = {},
): CreatorMilestone => ({
  key,
  threshold,
  title: key,
  unlocks: "",
  kind: "other",
  live: false,
  reached: false,
  ...extra,
});

describe("parseCreatorEarnings", () => {
  it("treats anything unexpected as not shown", () => {
    expect(parseCreatorEarnings(null)).toEqual({ visible: false });
    expect(parseCreatorEarnings({ visible: "yes" })).toEqual({ visible: false });
  });

  it("keeps good milestones, sorted, and drops broken ones", () => {
    const r = parseCreatorEarnings({
      visible: true,
      enabled: false,
      analytics_enabled: true,
      qualifying_visitors: 42.7,
      milestones: [
        {
          key: "b",
          threshold: 1000,
          title: "B",
          unlocks: "x",
          kind: "subscription_application",
          live: false,
          reached: false,
        },
        {
          key: "a",
          threshold: 100,
          title: "A",
          unlocks: "y",
          kind: "weird",
          live: true,
          reached: false,
        },
        { key: "bad", threshold: 0, title: "Bad" },
        { title: "no key", threshold: 5 },
      ],
    });
    expect(r.visible).toBe(true);
    if (!r.visible) return;
    expect(r.qualifying_visitors).toBe(42);
    expect(r.milestones.map((x) => x.key)).toEqual(["a", "b"]);
    expect(r.milestones[0].kind).toBe("other");
    expect(r.enabled).toBe(false);
  });

  it("never reads a negative count", () => {
    const r = parseCreatorEarnings({ visible: true, qualifying_visitors: -5, milestones: [] });
    expect(r.visible && r.qualifying_visitors).toBe(0);
  });
});

describe("nextMilestone", () => {
  const list = [m("a", 100), m("b", 500), m("c", 1000)];

  it("measures progress from the previous milestone", () => {
    expect(nextMilestone(0, list)).toMatchObject({
      milestone: { key: "a" },
      remaining: 100,
      progress: 0,
    });
    expect(nextMilestone(300, list)).toMatchObject({
      milestone: { key: "b" },
      remaining: 200,
      progress: 0.5,
    });
  });

  it("counts the threshold itself as reached", () => {
    expect(nextMilestone(100, list)?.milestone.key).toBe("b");
  });

  it("returns nothing once every milestone is reached", () => {
    expect(nextMilestone(5000, list)).toBeNull();
    expect(nextMilestone(10, [])).toBeNull();
  });
});

describe("milestoneStatus", () => {
  it("promises nothing for a planned milestone, even when the count is there", () => {
    expect(milestoneStatus(m("a", 1, { live: false, reached: true }))).toBe("Coming later");
  });
  it("says locked or unlocked for a live one", () => {
    expect(milestoneStatus(m("a", 1, { live: true, reached: false }))).toBe("Locked");
    expect(milestoneStatus(m("a", 1, { live: true, reached: true }))).toBe("Unlocked");
  });
});
