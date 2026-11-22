import { createFileRoute, redirect } from "@tanstack/react-router";

/** "terms" is a reserved username, so this short address is safe to use. */
export const Route = createFileRoute("/terms")({
  beforeLoad: () => {
    throw redirect({ to: "/legal/$doc", params: { doc: "terms" }, replace: true });
  },
});
