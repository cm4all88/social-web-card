import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
  Share2,
  Unplug,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  disconnectStripeAccount,
  getTippingAvailability,
  refreshStripeAccount,
  refundTip,
  startStripeOnboarding,
} from "@/lib/tipping/functions";
import { formatUsd } from "@/lib/tipping/money";
import type { PaymentAccountStatus } from "@/lib/tipping/account-status";

type Settings = { enabled: boolean; show_on_profile: boolean; button_text: string };
type AccountRow = {
  status: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  requirements_due_count: number;
  disabled_reason: string | null;
};
type TipRow = {
  id: string;
  created_at: string;
  paid_at: string | null;
  tip_amount_cents: number;
  amount_refunded_cents: number;
  status: string;
  dispute_status: string | null;
  supporter_name: string | null;
  supporter_message: string | null;
};

const STATUS_COPY: Record<PaymentAccountStatus, { label: string; tone: string; help: string }> = {
  not_started: {
    label: "Not connected",
    tone: "bg-muted text-muted-foreground",
    help: "Connect a Stripe account to receive tips.",
  },
  pending: {
    label: "Setup in progress",
    tone: "bg-amber-500/15 text-amber-600",
    help: "Finish Stripe's setup to start receiving tips.",
  },
  restricted: {
    label: "Action needed",
    tone: "bg-red-500/15 text-red-600",
    help: "Stripe needs more information before you can receive tips.",
  },
  connected: {
    label: "Connected",
    tone: "bg-emerald-500/15 text-emerald-600",
    help: "You can receive tips.",
  },
  disconnected: {
    label: "Disconnected",
    tone: "bg-muted text-muted-foreground",
    help: "Tips are off. Reconnect to receive tips again.",
  },
};

const DEFAULT_SETTINGS: Settings = {
  enabled: false,
  show_on_profile: true,
  button_text: "Send a tip",
};

export function TipsManager({ userId, username }: { userId: string; username: string }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [account, setAccount] = useState<AccountRow | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [tips, setTips] = useState<TipRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: acct }, { data: s }, { data: t }] = await Promise.all([
      supabase
        .from("creator_payment_accounts")
        .select("status, charges_enabled, payouts_enabled, requirements_due_count, disabled_reason")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("tip_settings")
        .select("enabled, show_on_profile, button_text")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("tips")
        .select(
          "id, created_at, paid_at, tip_amount_cents, amount_refunded_cents, status, dispute_status, supporter_name, supporter_message",
        )
        .eq("creator_user_id", userId)
        .in("status", ["succeeded", "needs_review"])
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    setAccount((acct as AccountRow | null) ?? null);
    setSettings((s as Settings | null) ?? DEFAULT_SETTINGS);
    setTips((t ?? []) as TipRow[]);
  }, [userId]);

  useEffect(() => {
    getTippingAvailability()
      .then((r) => setAvailable(r.enabled))
      .catch(() => setAvailable(false));
  }, []);

  useEffect(() => {
    if (!available) return;
    const url = new URL(window.location.href);
    const fromStripe = url.searchParams.get("stripe");
    (async () => {
      if (fromStripe === "return") {
        try {
          await refreshStripeAccount();
        } catch {
          /* status shown from the database below */
        }
      }
      if (fromStripe === "refresh")
        toast.info("Your Stripe setup link expired. Tap Continue setup to get a new one.");
      if (fromStripe) {
        url.searchParams.delete("stripe");
        window.history.replaceState({}, "", url.toString());
      }
      await load();
    })();
  }, [available, load]);

  if (!available) return null;

  const status: PaymentAccountStatus = (account?.status as PaymentAccountStatus) ?? "not_started";
  const copy = STATUS_COPY[status];
  const connected = status === "connected" && !!account?.charges_enabled;
  const tipUrl = `${window.location.origin}/${username}/tip`;
  const shareText = `Send me a tip on Yooits: ${tipUrl}`;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const goToStripe = () =>
    run("onboard", async () => {
      const res = await startStripeOnboarding();
      if (res?.url) window.location.assign(res.url);
    });

  const saveSettings = () =>
    run("save", async () => {
      const text = settings.button_text.trim();
      if (text.length < 1 || text.length > 40)
        throw new Error("Button text must be 1–40 characters.");
      const { error } = await supabase.from("tip_settings").upsert({
        user_id: userId,
        ...settings,
        enabled: settings.enabled && connected,
        button_text: text,
      });
      if (error) throw new Error(error.message);
      toast.success("Tip settings saved");
    });

  const received = tips.filter((t) => t.status === "succeeded");
  const earned = received.reduce((sum, t) => sum + t.tip_amount_cents - t.amount_refunded_cents, 0);

  return (
    <div
      className="mt-8 rounded-2xl border border-border bg-card p-5"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">Tips</div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${copy.tone}`}>
          {copy.label}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {copy.help} Visitors pay your tip plus a $0.50 Yooits service fee. Stripe&apos;s card
        processing fee comes out of the tip, and payouts go to your bank through Stripe.
      </p>
      {status === "restricted" && account?.disabled_reason && (
        <p className="mt-2 text-sm text-red-600">
          Stripe says: {account.disabled_reason.replaceAll("_", " ")}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {status === "not_started" || status === "disconnected" ? (
          <Button onClick={goToStripe} disabled={busy !== null}>
            {busy === "onboard" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {status === "disconnected" ? "Reconnect Stripe" : "Connect with Stripe"}
          </Button>
        ) : (
          <>
            {status !== "connected" && (
              <Button onClick={goToStripe} disabled={busy !== null}>
                {busy === "onboard" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Continue setup
              </Button>
            )}
            <Button variant="secondary" asChild>
              <a href="https://dashboard.stripe.com/" target="_blank" rel="noreferrer noopener">
                <ExternalLink className="mr-2 h-4 w-4" /> Manage on Stripe
              </a>
            </Button>
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={() =>
                run("refresh", async () => {
                  await refreshStripeAccount();
                  await load();
                })
              }
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh status
            </Button>
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={() => {
                if (
                  !window.confirm(
                    "Turn off tips and disconnect Stripe from Yooits? Your Stripe account stays open.",
                  )
                )
                  return;
                run("disconnect", async () => {
                  await disconnectStripeAccount();
                  await load();
                });
              }}
            >
              <Unplug className="mr-2 h-4 w-4" /> Disconnect
            </Button>
          </>
        )}
      </div>

      {account && status !== "disconnected" && (
        <div className="mt-6 grid gap-4 rounded-xl border border-border p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="tips-enabled">Accept tips</Label>
              {!connected && (
                <p className="text-xs text-muted-foreground">
                  Available once Stripe setup is finished.
                </p>
              )}
            </div>
            <Switch
              id="tips-enabled"
              checked={settings.enabled && connected}
              disabled={!connected}
              onCheckedChange={(v) => setSettings({ ...settings, enabled: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="tips-profile">Show the tip button on my profile</Label>
            <Switch
              id="tips-profile"
              checked={settings.show_on_profile}
              onCheckedChange={(v) => setSettings({ ...settings, show_on_profile: v })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tips-text">Button text</Label>
            <Input
              id="tips-text"
              maxLength={40}
              value={settings.button_text}
              onChange={(e) => setSettings({ ...settings, button_text: e.target.value })}
            />
          </div>
          <div>
            <Button onClick={saveSettings} disabled={busy !== null}>
              Save tip settings
            </Button>
          </div>
        </div>
      )}

      {connected && settings.enabled && (
        <div className="mt-6">
          <div className="text-sm font-medium">Your direct tip link</div>
          <div className="mt-2 break-all rounded-lg bg-muted px-3 py-2 font-mono text-sm">
            {tipUrl}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                navigator.clipboard.writeText(tipUrl);
                toast.success("Tip link copied");
              }}
            >
              <Copy className="mr-2 h-4 w-4" /> Copy
            </Button>
            <Button size="sm" variant="secondary" asChild>
              <a href={`sms:?&body=${encodeURIComponent(shareText)}`}>
                <MessageSquare className="mr-2 h-4 w-4" /> Text
              </a>
            </Button>
            <Button size="sm" variant="secondary" asChild>
              <a
                href={`mailto:?subject=${encodeURIComponent("Tip me on Yooits")}&body=${encodeURIComponent(shareText)}`}
              >
                <Mail className="mr-2 h-4 w-4" /> Email
              </a>
            </Button>
            <Button size="sm" variant="secondary" asChild>
              <a
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                <Share2 className="mr-2 h-4 w-4" /> X
              </a>
            </Button>
            <Button size="sm" variant="secondary" asChild>
              <a
                href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(tipUrl)}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                <Share2 className="mr-2 h-4 w-4" /> Facebook
              </a>
            </Button>
            {typeof navigator !== "undefined" && "share" in navigator && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  navigator.share({ title: "Tip me on Yooits", url: tipUrl }).catch(() => {})
                }
              >
                <Share2 className="mr-2 h-4 w-4" /> More
              </Button>
            )}
          </div>
        </div>
      )}

      {account && (
        <div className="mt-6">
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-medium">Tips received</div>
            <div className="text-sm text-muted-foreground">
              {received.length} tip{received.length === 1 ? "" : "s"} ·{" "}
              <span className="font-semibold text-foreground">{formatUsd(earned)}</span> before
              Stripe fees
            </div>
          </div>
          {tips.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              No tips yet. Share your tip link to get started.
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
              {tips.map((t) => {
                const refunded = t.amount_refunded_cents > 0;
                return (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {formatUsd(t.tip_amount_cents)}
                        {t.supporter_name ? ` from ${t.supporter_name}` : ""}
                      </div>
                      {t.supporter_message && (
                        <div className="mt-0.5 break-words text-muted-foreground">
                          “{t.supporter_message}”
                        </div>
                      )}
                      <div className="mt-1 text-xs text-muted-foreground">
                        {new Date(t.paid_at ?? t.created_at).toLocaleString()}
                        {refunded && " · Refunded"}
                        {t.dispute_status && ` · Dispute: ${t.dispute_status.replaceAll("_", " ")}`}
                        {t.status === "needs_review" && " · Under review"}
                      </div>
                    </div>
                    {t.status === "succeeded" && !refunded && !t.dispute_status && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Refund ${formatUsd(t.tip_amount_cents)} plus the $0.50 service fee to the supporter?`,
                            )
                          )
                            return;
                          run(`refund-${t.id}`, async () => {
                            await refundTip({ data: { tipId: t.id } });
                            toast.success(
                              "Refund started. It can take a few days to reach the supporter.",
                            );
                            setTimeout(load, 3000);
                          });
                        }}
                      >
                        Refund
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
