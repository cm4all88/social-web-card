import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /admin moved: creators manage their page at /dashboard and the Yooits owner
 * console lives at /owner. Old bookmarks, email links and Stripe's return and
 * refresh links (/admin?stripe=...) keep working; the query string is kept.
 */
export const Route = createFileRoute("/admin/")({
  beforeLoad: ({ location }) => {
    throw redirect({ href: `/dashboard${location.searchStr ?? ""}`, replace: true });
  },
});
