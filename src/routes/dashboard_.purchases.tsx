import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { listDigitalPurchases, openDigitalPurchase } from "@/lib/digital-products/functions";

export const Route = createFileRoute("/dashboard_/purchases")({
  validateSearch: (search): { checkout?: "complete" } => ({
    checkout: search.checkout === "complete" ? "complete" : undefined,
  }),
  head: () => ({ meta: [{ title: "Purchases — Yooits.me" }] }),
  component: Purchases,
});

function Purchases() {
  const { checkout } = Route.useSearch();
  const [signedIn, setSignedIn] = useState<boolean>();
  const [items, setItems] = useState<Awaited<ReturnType<typeof listDigitalPurchases>>>();
  const [player, setPlayer] = useState<{ id: string; url: string; title: string }>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setNotice("");
    try {
      setItems(await listDigitalPurchases());
    } catch {
      setNotice("Could not load your purchases. Try refreshing.");
    }
  }

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSignedIn(!!data.session);
      if (data.session) void refresh();
    });
  }, []);

  async function open(id: string, title: string) {
    setNotice("");
    setBusy(true);
    try {
      const asset = await openDigitalPurchase({ data: { id } });
      if (asset.kind === "file") window.location.assign(asset.url);
      else setPlayer({ id, url: asset.url, title });
    } catch {
      setPlayer(undefined);
      setNotice("This purchase is unavailable. Refresh to check your access.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4 py-10">
      <Link to="/dashboard" className="text-sm text-primary">
        Dashboard
      </Link>
      <h1 className="text-2xl font-bold">Purchases</h1>
      {signedIn === false && (
        <Button asChild>
          <Link to="/auth" search={{ next: "/dashboard/purchases" }}>
            Sign in
          </Link>
        </Button>
      )}
      {signedIn === true && (
        <>
          {checkout && (
            <p className="text-sm">If your purchase is still processing, refresh in a moment.</p>
          )}
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            Refresh purchases
          </Button>
          {items?.length === 0 && <p>You don’t have any purchases yet.</p>}
          {!items && !notice && <p role="status">Loading purchases…</p>}
          <ul className="space-y-3">
            {items?.map(({ id, digital_products: product }) => (
              <li key={id} className="space-y-3 rounded-xl border bg-card p-4">
                <h2 className="font-semibold">{product.title}</h2>
                <Button size="sm" disabled={busy} onClick={() => void open(id, product.title)}>
                  {product.kind === "video" ? "Watch video" : "Download file"}
                </Button>
                {player?.id === id && (
                  <iframe
                    key={player.url}
                    src={player.url}
                    title={player.title}
                    className="aspect-video w-full rounded-lg"
                    allow="encrypted-media; picture-in-picture"
                    allowFullScreen
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {notice && <p role="alert">{notice}</p>}
    </main>
  );
}
