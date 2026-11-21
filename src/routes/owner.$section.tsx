import { createFileRoute, notFound } from "@tanstack/react-router";
import { plannedSection } from "@/lib/owner/nav";

/** Placeholder for owner sections that aren't built yet (wishlists, promotions, settings, analytics). */
export const Route = createFileRoute("/owner/$section")({
  beforeLoad: ({ params }) => {
    if (!plannedSection(params.section)) throw notFound();
  },
  component: PlannedSection,
});

function PlannedSection() {
  const { section } = Route.useParams();
  const s = plannedSection(section);
  if (!s) return null;
  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold">{s.label}</h1>
      <p className="mt-2 text-muted-foreground">{s.summary}</p>
      <div className="mt-6 rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
        Not built yet. This section has its place in the console so it can be added without reshaping the rest.
      </div>
    </div>
  );
}
