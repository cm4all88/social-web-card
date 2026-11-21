/** Reasons a visitor can give when reporting a page or wishlist. Mirrors the abuse_reports check. */
export const REPORT_REASONS = [
  { id: "spam", label: "Spam or misleading links" },
  { id: "scam", label: "Scam or fraud" },
  { id: "impersonation", label: "Pretending to be someone else" },
  { id: "harassment", label: "Harassment or hate" },
  { id: "sexual_content", label: "Sexual content" },
  { id: "illegal", label: "Something illegal" },
  { id: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["id"];

export const REPORT_REASON_IDS = REPORT_REASONS.map((r) => r.id) as [ReportReason, ...ReportReason[]];

export function reportReasonLabel(id: string): string {
  return REPORT_REASONS.find((r) => r.id === id)?.label ?? id;
}

export const REPORT_DETAILS_MAX = 1000;
