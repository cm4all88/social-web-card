import { createFileRoute, redirect } from "@tanstack/react-router";
import { legacyAdminTarget } from "@/lib/owner/legacy-admin";

/** Old /admin/... links: /admin/wishlists and /admin/revenue moved. */
export const Route = createFileRoute("/admin/$")({
  beforeLoad: ({ params, location }) => {
    throw redirect({ href: `${legacyAdminTarget(params._splat)}${location.searchStr ?? ""}`, replace: true });
  },
});
