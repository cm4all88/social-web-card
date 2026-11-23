import { createFileRoute, Link } from "@tanstack/react-router";
import { InviteCodes } from "@/components/owner/InviteCodes";

/**
 * Plain invite codes: single use or shared, with an optional expiry. Codes
 * that give free Plus belong to a promotion (Promotions page). Founding Member
 * codes have their own page and never show here.
 */
export const Route = createFileRoute("/owner/invites")({
  component: InvitesPage,
});

function InvitesPage() {
  return (
    <div className="max-w-5xl">
      <h1 className="text-3xl font-bold">Invites</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Sign-up is open, so a code is optional. Make one to see who joined from where. A code here gives no
        reward; for free Plus, make the codes inside a{" "}
        <Link to="/owner/promotions" className="text-primary hover:underline">
          promotion
        </Link>
        . Founding Member codes are on the{" "}
        <Link to="/owner/founding" className="text-primary hover:underline">
          Founding Members
        </Link>{" "}
        page.
      </p>
      <div className="mt-6">
        <InviteCodes />
      </div>
    </div>
  );
}
