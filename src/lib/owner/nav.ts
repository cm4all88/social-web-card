/**
 * Owner console sections. The console is laid out for everything Yooits will
 * eventually run from here (users, money, wishlists, promotions, settings,
 * analytics); sections marked "planned" show a placeholder until built.
 */
export type OwnerSection = {
  id: string;
  label: string;
  to: string;
  status: "live" | "planned";
  /** One line for the placeholder page and the overview. */
  summary: string;
};

export const OWNER_SECTIONS: OwnerSection[] = [
  { id: "overview", label: "Overview", to: "/owner", status: "live", summary: "Headline numbers." },
  { id: "users", label: "Users", to: "/owner/users", status: "live", summary: "Find people and see their account." },
  { id: "money", label: "Money", to: "/owner/revenue", status: "live", summary: "Tip revenue and stopping tips for a creator." },
  { id: "invites", label: "Invites", to: "/owner/invites", status: "live", summary: "Invite codes." },
  { id: "founding", label: "Founding Members", to: "/owner/founding", status: "live", summary: "Founding Member invites, members and feedback." },
  { id: "reports", label: "Reports", to: "/owner/reports", status: "live", summary: "Pages and wishlists people have reported." },
  { id: "blocked-sites", label: "Blocked sites", to: "/owner/blocked-sites", status: "live", summary: "Sites links may not point to, and exceptions for mistakes." },
  { id: "audit", label: "Audit log", to: "/owner/audit", status: "live", summary: "Every owner action, newest first." },
  { id: "wishlists", label: "Wishlists", to: "/owner/wishlists", status: "planned", summary: "Retailers, affiliate tags and wishlist moderation." },
  { id: "promotions", label: "Promotions", to: "/owner/promotions", status: "planned", summary: "House promotions shown across Yooits." },
  { id: "settings", label: "Settings", to: "/owner/settings", status: "planned", summary: "Feature switches and limits, changed without code." },
  { id: "analytics", label: "Analytics", to: "/owner/analytics", status: "live", summary: "Users, traffic, destinations, platforms, conversions and growth." },
];

export const PLANNED_SECTION_IDS = OWNER_SECTIONS.filter((s) => s.status === "planned").map((s) => s.id);

export function plannedSection(id: string): OwnerSection | undefined {
  return OWNER_SECTIONS.find((s) => s.status === "planned" && s.id === id);
}
