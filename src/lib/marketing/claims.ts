/**
 * Checks a post's words before it can be approved. "Blocked" phrases talk
 * about something that isn't live or public on Yooits.me (or is a claim Chris
 * ruled out, like "no fees"), so a post that has one can't be approved until
 * it's reworded. "Check" phrases aren't wrong in themselves but need a look.
 */
export type ClaimIssue = { level: "blocked" | "check"; phrase: string; why: string };

type Rule = { level: ClaimIssue["level"]; re: RegExp; why: string };

const RULES: Rule[] = [
  {
    level: "blocked",
    re: /\bno[\s-]+fees?\b|\bfee[\s-]?free\b|\bzero fees?\b|\b0% fees?\b/i,
    why: 'Never advertise "no fees".',
  },
  {
    level: "blocked",
    re: /\btipping\b|\btip jar\b|\btips? (me|creators?|them|your fans)\b|\b(send|leave|get|receive|accept) (a )?tips?\b|\bget tipped\b/i,
    why: "Tipping is off until Stripe approves it.",
  },
  {
    level: "blocked",
    re: /\b(paid|creator|fan|monthly|member) subscriptions?\b|\bpaying subscribers\b|\bsubscribe to (me|creators?|them) on yooits\b|\bfan memberships?\b/i,
    why: "Creator subscriptions are off.",
  },
  {
    level: "blocked",
    re: /\bgift (money|cash|funds?)\b|\bcash gifts?\b|\bsend (money|cash)\b|\bget paid\b|\bpayouts?\b|\bearn(ings)? money\b|\bmake money\b|\bmonetiz/i,
    why: "No money moves through Yooits.me yet.",
  },
  {
    level: "blocked",
    re: /\byooits(?:\.me)? pro\b|\bpro plan\b|\bpro tier\b/i,
    why: "Pro doesn't exist yet.",
  },
  { level: "blocked", re: /\bsupport offerings?\b/i, why: "Support Offerings are off." },
  {
    level: "blocked",
    re: /\bfounding members?\b|\bfounders? (club|badge|spot)\b/i,
    why: "Founding Member invites aren't public.",
  },
  {
    level: "blocked",
    re: /\b(yooits(?:\.me)? )?plus\b.*\b(\$|price|buy|upgrade|sign up|subscribe|month)\b|\$\s?4\.99|\bupgrade to plus\b/i,
    why: "Plus checkout isn't open to the public.",
  },
  { level: "blocked", re: /\bholiday lights\b/i, why: "Holiday Lights is a Plus theme." },
  { level: "blocked", re: /\bcustom domains?\b/i, why: "Custom domains aren't built." },
  { level: "blocked", re: /\baffiliate\b/i, why: "Affiliate links are off." },
  { level: "blocked", re: /\bonlyfans\b/i, why: "That preset was removed pending Stripe review." },
  {
    level: "blocked",
    re: /\b(ai[-\s]?(powered|generated)|artificial intelligence)\b/i,
    why: "Yooits.me doesn't have AI features to advertise.",
  },
  {
    level: "check",
    re: /\b(best|#1|number one|only) (link|bio|page)\b|\bbetter than (linktree|beacons|stan|komi)\b|\blinktree\b/i,
    why: "Comparisons with other products need to be fair and true.",
  },
  {
    level: "check",
    re: /\bguarantee(d)?\b|\bgo viral\b|\b10x\b|\bexplode\b/i,
    why: "Don't promise results.",
  },
  {
    level: "check",
    re: /\bthousands of (users|creators|people)\b|\beveryone('s| is) (using|on)\b|\bjoin \d[\d,]* /i,
    why: "Only state user numbers that are real.",
  },
  {
    level: "check",
    re: /\bpremium\b|\bunlock(ed)? with plus\b/i,
    why: "Premium features are Plus, which isn't on sale yet.",
  },
];

/** Generic marketing filler that makes posts read as machine-written. */
const FILLER = [
  "game changer",
  "game-changer",
  "unlock your potential",
  "elevate your",
  "take it to the next level",
  "in today's digital",
  "look no further",
  "revolutioniz",
  "seamless",
  "supercharge",
  "level up your brand",
  "dive in",
  "unleash",
  "boost your online presence",
  "one-stop shop",
];

export function checkClaims(text: string): ClaimIssue[] {
  const issues: ClaimIssue[] = [];
  for (const r of RULES) {
    const m = text.match(r.re);
    if (m) issues.push({ level: r.level, phrase: m[0], why: r.why });
  }
  const lower = text.toLowerCase();
  for (const f of FILLER) {
    if (lower.includes(f))
      issues.push({ level: "check", phrase: f, why: "Reads like generic ad copy." });
  }
  return issues;
}

export function hasBlockedClaim(text: string): boolean {
  return checkClaims(text).some((i) => i.level === "blocked");
}

/** All the words in a post that get read by people. */
export function postText(p: {
  title?: string | null;
  caption?: string | null;
  script?: string | null;
  hashtags?: string[] | null;
  graphic?: { headline?: string; sub?: string } | null;
}): string {
  return [
    p.title,
    p.caption,
    p.script,
    (p.hashtags ?? []).join(" "),
    p.graphic?.headline,
    p.graphic?.sub,
  ]
    .filter(Boolean)
    .join("\n");
}
