import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getPaymentsSetup, runPaymentsSetup } from "@/lib/payments/functions";
import { SETUP_WEBHOOKS } from "@/lib/payments/stripe-setup";

/** Owner > Payments: the Stripe account, setting it up, and what's ready to switch on. */
export const Route = createFileRoute("/owner/payments")({
  component: PaymentsPage,
  head: () => ({ meta: [{ title: "Payments — Yooits" }, { name: "robots", content: "noindex" }] }),
});

type Status = Awaited<ReturnType<typeof getPaymentsSetup>>;

const WEBHOOK_WORDS: Record<Status["webhooks"][number]["state"], string> = {
  ok: "Working",
  missing: "Not made yet",
  disabled: "Turned off in Stripe",
  events_missing: "Missing some events",
  no_secret: "No signing secret on this site",
};

function Mark({ ok, partial }: { ok: boolean; partial?: boolean }) {
  if (ok) return <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-label="Ready" />;
  if (partial)
    return <CircleDashed className="h-4 w-4 shrink-0 text-amber-600" aria-label="Not yet" />;
  return <XCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Missing" />;
}

function PaymentsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await getPaymentsSetup());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const setUp = async () => {
    setBusy(true);
    try {
      const r = await runPaymentsSetup();
      setSteps(r.steps);
      setStatus(r.status);
      toast.success("Stripe is set up for Yooits. Nothing was switched on.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const a = status?.account;
  const mode = status?.key.mode;
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Payments</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The Stripe account this site uses, and which payment features are ready. Setting up reuses
          the Plus price, billing portal and webhook already in Stripe, makes only what's missing,
          and checks the webhook. It charges nothing and turns nothing on.
        </p>
      </div>
      {error && <p className="text-muted-foreground">{error}</p>}
      {!status && !error && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
      {status && (
        <>
          <section className="rounded-2xl border border-border p-4">
            <h2 className="font-semibold">Stripe account</h2>
            {!mode && (
              <p className="mt-2 text-sm text-muted-foreground">
                There's no Stripe secret key on this site.
              </p>
            )}
            {status.accountError && (
              <p className="mt-2 text-sm text-destructive">
                Stripe refused the key: {status.accountError}
              </p>
            )}
            {a && (
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {[
                  ["Mode", mode === "live" ? "Live" : "Test"],
                  ["Account", a.id],
                  ["Public business name", a.businessName ?? "Not set"],
                  ["Dashboard name", a.displayName ?? "Not set"],
                  ["Legal entity", a.legalName ?? "Stripe doesn't share it here"],
                  ["Website", a.website ?? "Not set"],
                  ["Support email", a.supportEmail ?? "Not set"],
                  ["Statement descriptor", a.statementDescriptor ?? "Not set"],
                  ["Can take payments", a.chargesEnabled ? "Yes" : "No"],
                  ["Payouts", a.payoutsEnabled ? "Yes" : "No"],
                  [
                    "Stripe Connect (paying creators)",
                    status.connect.ok ? "Available" : (status.connect.note ?? "Not available"),
                  ],
                ].map(([k, v]) => (
                  <div key={k} className="flex flex-col">
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          {a && (
            <section className="rounded-2xl border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-semibold">Set up</h2>
                <Button onClick={setUp} disabled={busy || !status.base}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Set up Stripe for Yooits
                </Button>
              </div>
              {!status.base && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Open this page on yooits.me or test.yooits.me to set up.
                </p>
              )}
              <ul className="mt-3 space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <Mark ok={status.plusPrice.ok} /> Plus price, $4.99 a month
                </li>
                <li className="flex items-center gap-2">
                  <Mark ok={status.portal.ok} /> Billing portal for Plus (card, invoices, cancel)
                </li>
                {status.webhooks
                  .filter((w) => SETUP_WEBHOOKS.includes(w.item))
                  .map((w) => (
                    <li key={w.item} className="flex items-start gap-2">
                      <Mark ok={w.state === "ok"} partial={w.state === "events_missing"} />
                      <span>
                        {w.label} webhook: {WEBHOOK_WORDS[w.state]}
                        <span className="block text-xs text-muted-foreground">{w.url}</span>
                      </span>
                    </li>
                  ))}
              </ul>
              {steps && (
                <ul className="mt-3 list-disc pl-5 text-sm text-muted-foreground">
                  {steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="rounded-2xl border border-border p-4">
            <h2 className="font-semibold">Payment features</h2>
            <ul className="mt-3 space-y-4 text-sm">
              {status.features.map((f) => (
                <li key={f.id}>
                  <div className="flex items-center gap-2 font-medium">
                    <Mark ok={f.on} partial={!f.on && (f.ready || !!f.ownerOnly)} />
                    {f.label}:{" "}
                    {f.on
                      ? "On"
                      : f.ownerOnly
                        ? "On for your account only"
                        : f.ready
                          ? "Ready to switch on"
                          : "Not ready"}
                  </div>
                  {!f.on && (
                    <ul className="mt-1 list-disc pl-10 text-muted-foreground">
                      {(f.ready ? f.toTurnOn : f.missing).map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
