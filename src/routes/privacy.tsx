import { createFileRoute, redirect } from "@tanstack/react-router";

/** "privacy" is a reserved username, so this short address is safe to use. */
export const Route = createFileRoute("/privacy")({
  beforeLoad: () => {
    throw redirect({ to: "/legal/$doc", params: { doc: "privacy" }, replace: true });
  },
});
