import { useState } from "react";
import { Loader2, Lock } from "lucide-react";
import type { ThemeTokens } from "@/lib/themes";
import { readableTextOn } from "@/lib/contrast";
import { buttonRadiusFor } from "@/lib/themes";
import { createTipCheckout } from "@/lib/tipping/functions";
import {
  formatUsd,
  MIN_TIP_CENTS,
  parseDollarsToCents,
  PLATFORM_FEE_CENTS,
  quoteTip,
  SUGGESTED_TIP_CENTS,
} from "@/lib/tipping/money";

export type PublicTipConfig = {
  available: true;
  showOnProfile: boolean;
  buttonText: string;
  displayName: string;
  username: string;
  minCents: number;
  maxCents: number;
  feeCents: number;
};

type Props = {
  config: PublicTipConfig;
  theme: ThemeTokens;
  source: "profile" | "link";
};

/**
 * Visitor-facing tip form. Amounts shown here are for display only; the server
 * recomputes and validates everything before creating the Stripe Checkout.
 */
export function TipPanel({ config, theme, source }: Props) {
  const [selected, setSelected] = useState<number | "custom">(SUGGESTED_TIP_CENTS[1]);
  const [custom, setCustom] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tipCents = selected === "custom" ? parseDollarsToCents(custom) : selected;
  const quote = tipCents === null ? null : quoteTip(tipCents);
  const radius = buttonRadiusFor(theme.buttonStyle);

  const submit = async () => {
    if (!quote?.ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createTipCheckout({
        data: {
          username: config.username,
          amountCents: quote.quote.tipCents,
          supporterName: name.trim() || undefined,
          message: message.trim() || undefined,
          source,
        },
      });
      if (!res?.url) throw new Error("Couldn't start checkout.");
      window.location.assign(res.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start checkout.");
      setBusy(false);
    }
  };

  const chip = (active: boolean) => ({
    background: active ? theme.accent : "transparent",
    color: active ? readableTextOn(theme.accent) : theme.cardForeground,
    borderColor: active ? theme.accent : theme.border,
    borderRadius: radius,
  });

  return (
    <div
      className="w-full border p-5 text-left"
      style={{
        background: theme.card,
        color: theme.cardForeground,
        borderColor: theme.border,
        borderRadius: radius,
      }}
    >
      <div className="text-lg font-semibold">Tip {config.displayName}</div>
      <p className="mt-1 text-sm opacity-70">
        Minimum {formatUsd(MIN_TIP_CENTS)}. No account needed.
      </p>

      <div className="mt-4 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Tip amount">
        {SUGGESTED_TIP_CENTS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={selected === c}
            onClick={() => setSelected(c)}
            className="border py-2.5 text-sm font-semibold transition"
            style={chip(selected === c)}
          >
            {formatUsd(c).replace(".00", "")}
          </button>
        ))}
      </div>

      <label className="mt-3 block text-sm">
        <span className="opacity-80">Or enter an amount</span>
        <div
          className="mt-1 flex items-center border px-3"
          style={{
            borderColor: selected === "custom" ? theme.accent : theme.border,
            borderRadius: radius,
          }}
        >
          <span className="opacity-70">$</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            value={custom}
            onFocus={() => setSelected("custom")}
            onChange={(e) => {
              setSelected("custom");
              setCustom(e.target.value);
            }}
            placeholder="25"
            className="w-full bg-transparent px-2 py-2.5 outline-none"
            aria-label="Custom tip amount in dollars"
          />
        </div>
      </label>

      <label className="mt-3 block text-sm">
        <span className="opacity-80">Your name (optional)</span>
        <input
          value={name}
          maxLength={50}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full border bg-transparent px-3 py-2.5 outline-none"
          style={{ borderColor: theme.border, borderRadius: radius }}
        />
      </label>
      <label className="mt-3 block text-sm">
        <span className="opacity-80">Message (optional, only {config.displayName} sees it)</span>
        <textarea
          value={message}
          maxLength={280}
          rows={2}
          onChange={(e) => setMessage(e.target.value)}
          className="mt-1 w-full resize-none border bg-transparent px-3 py-2 outline-none"
          style={{ borderColor: theme.border, borderRadius: radius }}
        />
      </label>

      <dl className="mt-4 space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="opacity-80">Tip</dt>
          <dd>{quote?.ok ? formatUsd(quote.quote.tipCents) : "—"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="opacity-80">Yooits service fee</dt>
          <dd>{formatUsd(PLATFORM_FEE_CENTS)}</dd>
        </div>
        <div
          className="flex justify-between border-t pt-2 font-semibold"
          style={{ borderColor: theme.border }}
        >
          <dt>Total</dt>
          <dd>{quote?.ok ? formatUsd(quote.quote.totalCents) : "—"}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs opacity-60">
        The service fee goes to Yooits and doesn't come out of your tip. Card processing costs are
        taken from the tip by Stripe.
      </p>

      {quote && !quote.ok && <p className="mt-3 text-sm font-medium">{quote.error}</p>}
      {selected === "custom" && custom.trim() !== "" && tipCents === null && (
        <p className="mt-3 text-sm font-medium">Enter an amount like 15 or 15.50.</p>
      )}
      {error && (
        <p className="mt-3 text-sm font-medium" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={!quote?.ok || busy}
        onClick={submit}
        className="mt-4 flex w-full items-center justify-center gap-2 py-3 font-semibold transition disabled:opacity-50"
        style={{
          background: theme.accent,
          color: readableTextOn(theme.accent),
          borderRadius: radius,
        }}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
        {quote?.ok ? `Pay ${formatUsd(quote.quote.totalCents)} securely` : "Choose an amount"}
      </button>
      <p className="mt-2 text-center text-xs opacity-60">Payments are processed by Stripe.</p>
    </div>
  );
}
