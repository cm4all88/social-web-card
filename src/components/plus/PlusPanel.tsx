import { useCallback, useEffect, useState } from "react";
import { Crown, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getMyPlus, openBillingPortal, setPlusCancellation, startPlusCheckout } from "@/lib/billing/functions";
import { formatPlusDate, PLUS_PRICE_LABEL } from "@/lib/billing/plus";

export type MyPlus = Awaited<ReturnType<typeof getMyPlus>>;

/** The signed-in creator's Plus state, reloadable. null while loading or if it can't be read. */
export function useMyPlus() {
  const [plus, setPlus] = useState<MyPlus | null>(null);
  const reload = useCallback(async () => {
    try {
      const p = await getMyPlus();
      setPlus(p);
      return p;
    } catch {
      setPlus(null);
      return null;
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  return { plus, reload };
}

/** Whether the Plus section has anything to show this person. */
export function plusPanelVisible(plus: MyPlus | null): boolean {
  return !!plus && (plus.plan === "plus" || !!plus.subscription || plus.checkoutAvailable);
}

function statusLine(p: MyPlus): string {
  const s = p.subscription;
  if (s) {
    const end = formatPlusDate(s.currentPeriodEnd);
    if (s.status === "past_due") return "Your last Plus payment didn't go through. Stripe will try again; update your card to keep Plus.";
    if (s.status === "trialing") {
      const start = formatPlusDate(s.trialEnd);
      return s.cancelAtPeriodEnd
        ? `Plus is free until ${start}, then ends. You won't be charged.`
        : `Plus is free until ${start}, then ${PLUS_PRICE_LABEL} until you cancel.`;
    }
    if (s.status === "active") {
      return s.cancelAtPeriodEnd
        ? `Plus is cancelled and stays on until ${formatPlusDate(s.cancelAt) ?? end}. You won't be charged again.`
        : `Plus renews on ${end} for ${PLUS_PRICE_LABEL.replace(" a month", "")}. Cancel any time.`;
    }
    if (s.status === "incomplete") return "Your Plus payment is still being confirmed.";
    if (s.status === "unpaid" || s.status === "paused") return "Plus is paused because a payment didn't go through. Update your card to turn it back on.";
  }
  if (p.founding) return `Founding Member: Plus is free until ${formatPlusDate(p.founding.endsAt)}. Nothing renews or charges when it ends.`;
  if (p.plan === "plus") return "You're on Plus.";
  return "";
}

export function PlusPanel({
  plus,
  reload,
  hideBranding,
  userId,
  onHideBrandingChange,
}: {
  plus: MyPlus | null;
  reload: () => Promise<MyPlus | null>;
  hideBranding: boolean;
  userId: string;
  onHideBrandingChange: (v: boolean) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  // Back from Stripe Checkout: Plus turns on when Stripe confirms (webhook), so check a few times.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("plus") !== "started") return;
    url.searchParams.delete("plus");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    toast.success("Thanks! Plus turns on as soon as Stripe confirms your payment.");
    let tries = 0;
    const t = setInterval(async () => {
      tries += 1;
      const p = await reload();
      if ((p && p.subscription) || tries >= 6) clearInterval(t);
    }, 2500);
    return () => clearInterval(t);
  }, [reload]);

  if (!plus || !plusPanelVisible(plus)) return null;
  const isPlus = plus.plan === "plus";
  const sub = plus.subscription;

  const go = async (what: string, fn: () => Promise<{ url: string } | undefined>) => {
    setBusy(what);
    try {
      const r = await fn();
      if (r?.url) window.location.assign(r.url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      setBusy(null);
    }
  };

  const changeCancel = async (cancel: boolean) => {
    setBusy(cancel ? "cancel" : "resume");
    try {
      await setPlusCancellation({ data: { cancel } });
      await reload();
      toast.success(cancel ? "Plus is cancelled. It stays on until the end of the month you paid for." : "Plus will keep renewing.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const toggleBranding = async (v: boolean) => {
    onHideBrandingChange(v);
    const { error } = await supabase.from("profiles").update({ hide_branding: v } as never).eq("user_id", userId);
    if (error) {
      onHideBrandingChange(!v);
      toast.error(/part of Plus/i.test(error.message) ? "Hiding the Yooits line is part of Plus." : error.message);
    } else {
      toast.success(v ? "The Yooits line is hidden on your page" : "The Yooits line is back on your page");
    }
  };

  return (
    <section
      id="plus"
      aria-labelledby="plus-heading"
      className="mt-8 scroll-mt-20 rounded-2xl border border-primary/40 bg-primary/5 p-5"
    >
      <h2 id="plus-heading" className="flex items-center gap-2 text-lg font-bold">
        <Crown className="h-5 w-5 text-primary" /> Yooits Plus
        {sub?.testMode && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal">Test mode</span>}
      </h2>

      {isPlus || sub ? (
        <p className="mt-1 text-sm">{statusLine(plus)}</p>
      ) : (
        <p className="mt-1 text-sm">
          Premium themes and the option to hide the Yooits line on your page, for {PLUS_PRICE_LABEL}. Your links stay
          free and unlimited either way.
        </p>
      )}

      {isPlus && (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
          <div>
            <Label htmlFor="hide-branding" className="font-medium">Hide "Create your free Yooits."</Label>
            <p className="text-xs text-muted-foreground">Removes the Yooits line at the bottom of your page while you're on Plus.</p>
          </div>
          <Switch id="hide-branding" checked={hideBranding} onCheckedChange={toggleBranding} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {plus.checkoutAvailable && (
          <div className="w-full space-y-2">
            <Button onClick={() => go("checkout", () => startPlusCheckout())} disabled={!!busy}>
              {busy === "checkout" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Crown className="mr-2 h-4 w-4" />}
              {plus.founding ? "Keep Plus after my free months" : `Get Plus for ${PLUS_PRICE_LABEL}`}
            </Button>
            <p className="text-xs text-muted-foreground">
              {plus.founding
                ? `You won't be charged before ${formatPlusDate(plus.founding.endsAt)}. Then ${PLUS_PRICE_LABEL}, renewing monthly until you cancel.`
                : `${PLUS_PRICE_LABEL}, renewing monthly until you cancel. Cancel any time; Plus stays on until the end of the month you paid for.`}
            </p>
          </div>
        )}
        {sub && plus.canManageBilling && (sub.status === "active" || sub.status === "trialing") && (
          sub.cancelAtPeriodEnd ? (
            <Button variant="secondary" onClick={() => changeCancel(false)} disabled={!!busy}>
              {busy === "resume" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Keep Plus
            </Button>
          ) : (
            <Button variant="outline" onClick={() => changeCancel(true)} disabled={!!busy}>
              {busy === "cancel" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Cancel Plus
            </Button>
          )
        )}
        {plus.canManageBilling && (
          <Button variant="ghost" onClick={() => go("portal", () => openBillingPortal())} disabled={!!busy}>
            {busy === "portal" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}
            Billing and receipts
          </Button>
        )}
      </div>
    </section>
  );
}
