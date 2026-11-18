/**
 * Who may receive tips. Stripe supports tips for content or a service that was
 * provided, not personal or peer-to-peer money transfers, so a Yooits user can
 * receive tips only when they:
 *   - say what kind of creator or service provider they are,
 *   - say what supporters are tipping them for,
 *   - confirm tips are for that content or service (not personal gifts),
 *   - have at least one public link on their profile (where their work is), and
 *   - haven't been suspended by a Yooits admin.
 * Everyone keeps normal profiles and wishlists regardless.
 *
 * The values here must match the CHECK constraint on tip_settings.creator_type.
 */
export const CREATOR_TYPES = [
  { value: "content_creator", label: "Content creator (video, streaming, podcasts, social)" },
  { value: "artist", label: "Artist or musician" },
  { value: "writer", label: "Writer or journalist" },
  { value: "educator", label: "Educator, coach or tutor" },
  { value: "service_provider", label: "Service provider (e.g. stylist, guide, performer)" },
] as const;

export type CreatorType = (typeof CREATOR_TYPES)[number]["value"];

export const OFFERING_MIN = 10;
export const OFFERING_MAX = 160;

export const ATTESTATION_TEXT =
  "Tips I receive are for content or services I provide. They aren't personal gifts, loans or money transfers.";

export type EligibilityInput = {
  creatorType: string | null | undefined;
  offering: string | null | undefined;
  attestedAt: string | null | undefined;
  publicLinkCount: number;
  suspended: boolean;
};

export type EligibilityProblem =
  | "creator_type"
  | "offering"
  | "attestation"
  | "public_link"
  | "suspended";

export const PROBLEM_COPY: Record<EligibilityProblem, string> = {
  creator_type: "Choose what kind of creator or service provider you are.",
  offering: `Describe what supporters are tipping you for (${OFFERING_MIN}–${OFFERING_MAX} characters).`,
  attestation: "Confirm that tips are for your content or services.",
  public_link: "Add at least one link to your work on your profile.",
  suspended: "Tipping has been turned off for this account. Contact Yooits support.",
};

export function isCreatorType(v: unknown): v is CreatorType {
  return CREATOR_TYPES.some((t) => t.value === v);
}

export function tipEligibility(
  input: EligibilityInput,
): { ok: true } | { ok: false; problems: EligibilityProblem[] } {
  const problems: EligibilityProblem[] = [];
  if (input.suspended) problems.push("suspended");
  if (!isCreatorType(input.creatorType)) problems.push("creator_type");
  const offering = (input.offering ?? "").trim();
  if (offering.length < OFFERING_MIN || offering.length > OFFERING_MAX) problems.push("offering");
  if (!input.attestedAt) problems.push("attestation");
  if (!(input.publicLinkCount > 0)) problems.push("public_link");
  return problems.length ? { ok: false, problems } : { ok: true };
}

/** Text Stripe sees on the connected account, to describe the business. */
export function stripeProductDescription(creatorType: CreatorType, offering: string): string {
  const label = CREATOR_TYPES.find((t) => t.value === creatorType)?.label ?? "Creator";
  return `Tips from supporters via Yooits. ${label}: ${offering.trim()}`.slice(0, 250);
}
