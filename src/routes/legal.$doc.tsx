import { createFileRoute, notFound } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal/LegalPage";
import { getLegalDocument } from "@/lib/legal/documents";

/** yooits.me/legal/<terms | privacy | acceptable-use | creator-payment-terms>. */
export const Route = createFileRoute("/legal/$doc")({
  loader: ({ params }) => {
    const doc = getLegalDocument(params.doc);
    if (!doc) throw notFound();
    return doc;
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.title} — Yooits.me` },
          { name: "description", content: loaderData.summary },
          { name: "robots", content: "noindex" },
        ]
      : [],
  }),
  component: LegalDocRoute,
});

function LegalDocRoute() {
  return <LegalPage doc={Route.useLoaderData()} />;
}
