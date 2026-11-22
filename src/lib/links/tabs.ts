/** The creator dashboard's sections, and which one an address like /dashboard#plus opens. */
export type TabId =
  | "links"
  | "appearance"
  | "analytics"
  | "profile"
  | "wishlists"
  | "messages"
  | "support"
  | "account";

export const DASHBOARD_TABS: { id: TabId; label: string }[] = [
  { id: "links", label: "Links" },
  { id: "appearance", label: "Appearance" },
  { id: "analytics", label: "Analytics" },
  { id: "profile", label: "Profile" },
  { id: "wishlists", label: "Wishlists" },
  { id: "messages", label: "Messages" },
  { id: "support", label: "Support" },
  { id: "account", label: "Account" },
];

/** Older links (and Stripe's return address, #plus) still land on the right section. */
export function tabForHash(hash: string): TabId | null {
  const h = hash.replace(/^#/, "").toLowerCase();
  if (DASHBOARD_TABS.some((t) => t.id === h)) return h as TabId;
  if (h === "plus" || h === "theme-gallery") return "appearance";
  if (h === "earnings" || h === "tips") return "support";
  return null;
}
