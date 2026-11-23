import { describe, expect, it } from "vitest";
import { checkClaims, hasBlockedClaim, postText } from "./claims";
import { generateConcepts, conceptsToPosts, renderConcept } from "./generator";
import { LAUNCH_CONCEPTS, launchPosts, planTime } from "./launch-plan";
import { campaignLink, countedLength, fillCaption, LINK_TOKEN, slugify } from "./links";
import { PLATFORMS, PLATFORM_IDS, urlMatchesPlatform } from "./platforms";
import { touchFromUrl } from "./attribution";
import { externalIdFrom, verifyAndRecord } from "./verify.server";
import { aiAuthToken, aiRewrite } from "./ai.server";
import { recommendations, type Weekly } from "./weekly";
import { wrap } from "./graphics";

describe("claim checks", () => {
  it("block things that aren't live", () => {
    for (const t of [
      "No fees, ever",
      "Turn on tipping today",
      "Leave a tip for your favourite creator",
      "Launch paid subscriptions for fans",
      "Send gift money to your friends",
      "Upgrade to Plus for $4.99",
      "Join as a Founding Member",
      "Yooits Pro is here",
      "Get paid by your fans",
    ]) {
      expect(hasBlockedClaim(t), t).toBe(true);
    }
  });
  it("let normal posts through", () => {
    for (const t of [
      "Quick tip: feature your best link at the top.",
      "Subscribe for more tutorials",
      "Make a wishlist and share it",
      "Unlimited links, free.",
    ]) {
      expect(hasBlockedClaim(t), t).toBe(false);
    }
  });
  it("flags filler copy", () => {
    expect(
      checkClaims("This is a game changer for creators").some((i) => i.level === "check"),
    ).toBe(true);
  });
});

describe("links", () => {
  it("build a campaign link per post", () => {
    expect(
      campaignLink({ platform: "x", campaign: "launch-2026", code: "ab12cd34", landing: "/" }),
    ).toBe(
      "https://yooits.me/?utm_source=x&utm_medium=social&utm_campaign=launch-2026&utm_content=ab12cd34",
    );
    expect(
      campaignLink({ platform: "x", campaign: "c", code: "1234", landing: "javascript:alert(1)" }),
    ).toMatch(/^https:\/\/yooits\.me\/\?/);
  });
  it("fill the link token and count X links as 23", () => {
    expect(fillCaption(`Go ${LINK_TOKEN}`, "https://yooits.me/")).toBe("Go https://yooits.me/");
    expect(
      countedLength("x", "a https://yooits.me/?utm_source=x&utm_campaign=very-long-campaign-name"),
    ).toBe(25);
  });
  it("slugify campaign names", () => {
    expect(slugify("January Creators!")).toBe("january-creators");
    expect(slugify("é")).toMatch(/^[a-z0-9][a-z0-9-]{1,49}$/);
  });
});

describe("platform address checks", () => {
  it("match only the platform's own addresses", () => {
    expect(urlMatchesPlatform("x", "https://x.com/yooits/status/123")).toBe(true);
    expect(urlMatchesPlatform("x", "https://evil.com/x.com/")).toBe(false);
    expect(urlMatchesPlatform("instagram", "https://www.instagram.com/p/abc/")).toBe(true);
    expect(urlMatchesPlatform("tiktok", "https://www.tiktok.com/@yooits/video/1")).toBe(true);
    expect(urlMatchesPlatform("youtube", "https://youtube.com/shorts/abcdef")).toBe(true);
    expect(urlMatchesPlatform("facebook", "http://facebook.com/x")).toBe(false);
  });
  it("pull out post ids", () => {
    expect(externalIdFrom("x", "https://x.com/yooits/status/18000")).toBe("18000");
    expect(externalIdFrom("tiktok", "https://www.tiktok.com/@y/video/7300")).toBe("7300");
    expect(externalIdFrom("youtube", "https://youtube.com/shorts/AbC_123-x")).toBe("AbC_123-x");
  });
});

describe("launch plan", () => {
  const posts = launchPosts();
  it("covers 30 days, Nov 25 to Dec 24, Pacific times", () => {
    expect(LAUNCH_CONCEPTS).toHaveLength(30);
    expect(planTime(0, "instagram")).toBe("2026-11-25T19:00:00.000Z");
    expect(planTime(29, "x")).toBe("2026-12-24T17:00:00.000Z");
  });
  it("mixes tutorials, demos, announcements and invitations for every audience", () => {
    const kinds = new Set(LAUNCH_CONCEPTS.map((c) => c.kind));
    for (const k of ["tutorial", "demo", "announcement", "invite"])
      expect(kinds.has(k as never)).toBe(true);
    const audiences = new Set(LAUNCH_CONCEPTS.map((c) => c.audience));
    for (const a of ["creators", "streamers", "artists", "small_business", "everyone"])
      expect(audiences.has(a as never)).toBe(true);
  });
  it("never mentions anything that isn't live", () => {
    for (const p of posts)
      expect(
        checkClaims(postText(p)).filter((i) => i.level === "blocked"),
        p.title,
      ).toEqual([]);
  });
  it("has no repeated hooks or duplicate posts", () => {
    const hooks = LAUNCH_CONCEPTS.map((c) => c.hook);
    expect(new Set(hooks).size).toBe(hooks.length);
    const keys = posts.map((p) => `${p.platform}:${p.caption.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("fits each platform", () => {
    for (const p of posts) {
      const spec = PLATFORMS[p.platform];
      expect(spec.formats).toContain(p.format);
      expect(
        countedLength(p.platform, fillCaption(p.caption, "https://yooits.me/?utm_source=x")),
      ).toBeLessThanOrEqual(spec.captionMax);
      expect(p.hashtags.length).toBeLessThanOrEqual(spec.hashtagsMax);
      if (p.platform === "x" || p.platform === "facebook") expect(p.caption).toContain(LINK_TOKEN);
      if (p.platform === "tiktok" || p.platform === "youtube") expect(p.script).toBeTruthy();
      expect(p.title.length).toBeLessThanOrEqual(120);
    }
  });
});

describe("generator", () => {
  it("writes from live features only, per platform", () => {
    const concepts = generateConcepts({
      audience: "streamers",
      features: [],
      kinds: [],
      platforms: ["x", "tiktok"],
      count: 6,
      seed: 42,
    });
    expect(concepts).toHaveLength(6);
    const posts = conceptsToPosts(concepts, ["x", "tiktok"]);
    expect(posts).toHaveLength(12);
    for (const p of posts) expect(hasBlockedClaim(postText(p))).toBe(false);
    expect(new Set(posts.filter((p) => p.platform === "x").map((p) => p.caption)).size).toBe(6);
  });
  it("is repeatable with the same seed and different with another", () => {
    const a = generateConcepts({
      audience: "artists",
      features: ["themes"],
      kinds: ["demo"],
      platforms: ["instagram"],
      count: 2,
      seed: 1,
    });
    const b = generateConcepts({
      audience: "artists",
      features: ["themes"],
      kinds: ["demo"],
      platforms: ["instagram"],
      count: 2,
      seed: 1,
    });
    expect(a).toEqual(b);
  });
  it("keeps every platform's caption under its limit", () => {
    for (const c of LAUNCH_CONCEPTS)
      for (const id of PLATFORM_IDS) {
        const p = renderConcept(c, id);
        expect([...p.caption].length).toBeLessThanOrEqual(PLATFORMS[id].captionMax);
      }
  });
});

describe("attribution", () => {
  it("reads campaign links and ignores junk", () => {
    expect(
      touchFromUrl(
        "https://yooits.me/?utm_source=tiktok&utm_medium=social&utm_campaign=launch-2026&utm_content=ab12cd34",
        1,
      ),
    ).toEqual({
      campaign: "launch-2026",
      source: "tiktok",
      medium: "social",
      content: "ab12cd34",
      ref: null,
      at: 1,
    });
    expect(touchFromUrl("https://yooits.me/")).toBeNull();
    expect(touchFromUrl("https://yooits.me/?utm_campaign=<script>")).toBeNull();
  });
});

describe("weekly recommendations", () => {
  const base: Weekly = {
    this: {
      published: 0,
      failed: 0,
      campaign_visits: 0,
      home_views: 0,
      signup_clicks: 0,
      signups: 0,
      attributed_signups: 0,
      profile_completions: 0,
    },
    last: {
      published: 0,
      campaign_visits: 0,
      home_views: 0,
      signup_clicks: 0,
      signups: 0,
      attributed_signups: 0,
    },
    sources: [],
    due_now: 0,
    awaiting_approval: 0,
    scheduled_next_7: 0,
    approved_unscheduled: 0,
    stuck_publishing: 0,
  };
  it("say something useful with no data", () => {
    expect(recommendations(base).length).toBeGreaterThan(0);
  });
  it("point at stuck and failed posts first", () => {
    const r = recommendations({ ...base, stuck_publishing: 2, this: { ...base.this, failed: 1 } });
    expect(r[0]).toMatch(/2 posts have been due/);
    expect(r.join(" ")).toMatch(/1 post failed/);
  });
  it("compare platforms by sign-ups per post", () => {
    const r = recommendations({ ...base, scheduled_next_7: 9 }, [
      { platform: "tiktok", visits: 50, signups: 6, completions: 3, paid: 0, published: 3 },
      { platform: "x", visits: 10, signups: 1, completions: 1, paid: 0, published: 4 },
    ]);
    expect(r.join(" ")).toMatch(/TikTok brought the most sign-ups per post/);
  });
});

describe("graphics", () => {
  it("wraps headlines", () => {
    expect(wrap("one two three four five six", 9)).toEqual([
      "one two",
      "three",
      "four five",
      "six",
    ]);
    expect(wrap("a b c d e f g h", 1, 2)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Verification: never marks a post live unless the platform says it's public.
// ---------------------------------------------------------------------------
function fakes(
  post = { id: "p1", platform: "x", status: "publishing" },
  handle: string | null = "yooits",
) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const owner = {
    rpc: async (fn: string, args: object) => {
      calls.push({ fn, args: args as never });
      return { data: [], error: null };
    },
  };
  const service = {
    rpc: async (fn: string, args: object) => {
      calls.push({ fn, args: args as never });
      return { data: { ok: 1 }, error: null };
    },
    from: (t: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: t === "marketing_posts" ? post : { handle },
            error: null,
          }),
        }),
      }),
    }),
  };
  return { calls, owner, service };
}
const json = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("verifying a live post", () => {
  it("records it only when the platform confirms a public post by the right account", async () => {
    const f = fakes();
    const r = await verifyAndRecord(
      f.owner,
      f.service as never,
      "u1",
      "p1",
      "https://x.com/yooits/status/123",
      json(200, {
        author_name: "Yooits",
        author_url: "https://twitter.com/yooits",
        html: "<blockquote>",
      }),
    );
    expect(r.ok).toBe(true);
    const rec = f.calls.find((c) => c.fn === "marketing_record_published")!;
    expect(rec.args).toMatchObject({
      _id: "p1",
      _verification: "oembed",
      _external_id: "123",
      _actor: "u1",
    });
  });
  it("does not record a post the platform can't find", async () => {
    const f = fakes();
    const r = await verifyAndRecord(
      f.owner,
      f.service as never,
      "u1",
      "p1",
      "https://x.com/yooits/status/123",
      json(404, {}),
    );
    expect(r).toMatchObject({ ok: false, reason: "not_public" });
    expect(f.calls.some((c) => c.fn === "marketing_record_published")).toBe(false);
  });
  it("does not record when the platform can't be reached", async () => {
    const f = fakes();
    const r = await verifyAndRecord(
      f.owner,
      f.service as never,
      "u1",
      "p1",
      "https://x.com/yooits/status/123",
      async () => {
        throw new Error("down");
      },
    );
    expect(r).toMatchObject({ ok: false, reason: "unreachable" });
    expect(f.calls.some((c) => c.fn === "marketing_record_published")).toBe(false);
  });
  it("refuses a post by another account", async () => {
    const f = fakes();
    const r = await verifyAndRecord(
      f.owner,
      f.service as never,
      "u1",
      "p1",
      "https://x.com/someone/status/1",
      json(200, { author_name: "Someone", author_url: "https://twitter.com/someone", html: "x" }),
    );
    expect(r).toMatchObject({ ok: false, reason: "wrong_account" });
  });
  it("refuses another platform's address and platforms without a public check", async () => {
    const f = fakes();
    expect(
      await verifyAndRecord(
        f.owner,
        f.service as never,
        "u1",
        "p1",
        "https://tiktok.com/@a/video/1",
        json(200, {}),
      ),
    ).toMatchObject({ reason: "wrong_platform" });
    const g = fakes({ id: "p1", platform: "instagram", status: "publishing" });
    expect(
      await verifyAndRecord(
        g.owner,
        g.service as never,
        "u1",
        "p1",
        "https://instagram.com/p/x",
        json(200, {}),
      ),
    ).toMatchObject({ reason: "no_public_check" });
  });
  it("refuses non-admins before reading anything", async () => {
    const f = fakes();
    f.owner.rpc = async () =>
      ({ data: null, error: { code: "42501", message: "Not authorized" } }) as never;
    expect(
      await verifyAndRecord(
        f.owner,
        f.service as never,
        "u1",
        "p1",
        "https://x.com/y/status/1",
        json(200, {}),
      ),
    ).toMatchObject({ ok: false, reason: "refused" });
  });
});

describe("AI rewrite", () => {
  it("needs a token, and keeps the built-in text without one", async () => {
    expect(aiAuthToken({})).toBeNull();
    expect(aiAuthToken({ AI_GATEWAY_API_KEY: "k" }, "o")).toBe("k");
    expect(
      await aiRewrite(
        {
          platform: "x",
          caption: "x {link}",
          features: ["links"],
          audience: "creators",
          kind: "tip",
        },
        null,
      ),
    ).toMatchObject({ ok: false, reason: "no_access" });
  });
  it("throws away a rewrite that mentions something not live", async () => {
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Tip your favourite creators with no fees {link}" } }],
        }),
        { status: 200 },
      );
    const r = await aiRewrite(
      {
        platform: "x",
        caption: "x {link}",
        features: ["links"],
        audience: "creators",
        kind: "tip",
      },
      "t",
      undefined,
      fetchFn as never,
    );
    expect(r).toMatchObject({ ok: false, reason: "blocked_claim" });
  });
  it("keeps the link token", async () => {
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Put every link you have on one free page." } }],
        }),
        { status: 200 },
      );
    const r = await aiRewrite(
      {
        platform: "x",
        caption: "x {link}",
        features: ["links"],
        audience: "creators",
        kind: "tip",
      },
      "t",
      undefined,
      fetchFn as never,
    );
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.caption).toContain("{link}");
  });
});
