/**
 * Where an old /admin/<path> link should go now. Creator pages moved to
 * /dashboard; the owner-only revenue report moved into the owner console.
 * Only known paths are mapped; anything else lands on the creator dashboard.
 */
export function legacyAdminTarget(splat: string | undefined): string {
  const path = (splat ?? "").replace(/^\/+|\/+$/g, "").toLowerCase();
  switch (path) {
    case "":
      return "/dashboard";
    case "wishlists":
      return "/dashboard/wishlists";
    case "revenue":
      return "/owner/revenue";
    default:
      return "/dashboard";
  }
}
