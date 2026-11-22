/**
 * Server side of the owner's Payments page: reads the Stripe account behind
 * STRIPE_SECRET_KEY and sets up what Yooits needs in it (the Plus price, the
 * billing portal and three webhook endpoints), storing each endpoint's signing
 * secret sealed in stripe_setup_items. Works without any payment switch, so
 * the owner can set Stripe up before anything is sold. It never charges,
 * never switches a feature on and never returns a secret.
 */
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  PLUS_CURRENCY,
  PLUS_INTERVAL,
  PLUS_METADATA_KEY,
  PLUS_METADATA_VALUE,
  PLUS_PRICE_CENTS,
  PLUS_PRICE_LOOKUP_KEY,
  priceIsPlus,
} from "@/lib/billing/plus";
import { openSecret, sealSecret } from "./secret-box";
import {
  choosePlusPrice,
  endpointsForPlan,
  keyMode,
  SETUP_WEBHOOKS,
  missingEvents,
  portalConfigurationParams,
  WEBHOOK_PLANS,
  type KeyMode,
  type SetupItem,
  type WebhookItem,
  type WebhookPlan,
} from "./stripe-setup";

const env = (name: string): string | undefined => {
  const v = typeof process !== "undefined" ? process.env?.[name] : undefined;
  return v && v.trim().length > 0 ? v.trim() : undefined;
};
const db = () => supabaseAdmin as unknown as SupabaseClient;

export function stripeKey(): { key: string; mode: KeyMode } | null {
  const key = env("STRIPE_SECRET_KEY");
  const mode = keyMode(key);
  return key && mode ? { key, mode } : null;
}

let cached: { key: string; client: Stripe } | undefined;
/** A Stripe client for the configured key, whatever the feature switches say. */
export function keyOnlyStripe(key: string): Stripe {
  if (cached?.key === key) return cached.client;
  const client = new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    appInfo: { name: "Yooits" },
  });
  cached = { key, client };
  return client;
}

type Row = {
  item: SetupItem;
  livemode: boolean;
  stripe_account_id: string;
  object_id: string;
  url: string | null;
  secret_ciphertext: string | null;
  secret_iv: string | null;
};

async function rows(livemode: boolean): Promise<Row[]> {
  const { data, error } = await db()
    .from("stripe_setup_items")
    .select("*")
    .eq("livemode", livemode);
  if (error) throw error;
  return (data ?? []) as Row[];
}

let secretCache: { key: string; at: number; secrets: Map<WebhookItem, string> } | undefined;

/** Signing secrets stored by Set up, for the configured key's mode. Empty on any failure. */
export async function storedWebhookSecrets(items: WebhookItem[]): Promise<string[]> {
  const k = stripeKey();
  if (!k) return [];
  try {
    if (!secretCache || secretCache.key !== k.key || Date.now() - secretCache.at > 60_000) {
      const map = new Map<WebhookItem, string>();
      for (const r of await rows(k.mode === "live")) {
        if (r.item === "portal_configuration" || !r.secret_ciphertext || !r.secret_iv) continue;
        const s = await openSecret(r.secret_ciphertext, r.secret_iv, k.key);
        if (s) map.set(r.item, s);
      }
      secretCache = { key: k.key, at: Date.now(), secrets: map };
    }
    return items.map((i) => secretCache!.secrets.get(i)).filter((s): s is string => !!s);
  } catch (e) {
    console.error("[stripe-setup] stored secrets unavailable", (e as Error)?.message);
    return [];
  }
}

/** The billing portal configuration Set up made for this mode, if any. */
export async function storedPortalConfigurationId(livemode: boolean): Promise<string | null> {
  try {
    const r = (await rows(livemode)).find((x) => x.item === "portal_configuration");
    return r?.object_id ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// What the owner sees
// ---------------------------------------------------------------------------
export type WebhookState = {
  item: WebhookItem;
  label: string;
  url: string;
  state: "ok" | "missing" | "disabled" | "events_missing" | "no_secret";
  secretFrom: "vercel" | "setup" | null;
};

export type StripeOverview = {
  key: { mode: KeyMode | null; onProduction: boolean };
  account: {
    id: string;
    businessName: string | null;
    displayName: string | null;
    legalName: string | null;
    website: string | null;
    supportEmail: string | null;
    statementDescriptor: string | null;
    country: string | null;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
  } | null;
  accountError: string | null;
  connect: { ok: boolean; note: string | null };
  plusPrice: { ok: boolean; id: string | null };
  portal: { ok: boolean };
  webhooks: WebhookState[];
  base: string | null;
};

function plain(e: unknown): string {
  const m = (e as { message?: string })?.message ?? "Stripe didn't answer.";
  // Stripe error messages never contain the key, but keep them short.
  return m.replace(/(sk|rk|whsec)_[A-Za-z0-9_]+/g, "[hidden]").slice(0, 240);
}

async function findPrice(stripe: Stripe): Promise<Stripe.Price | null> {
  const id = env("STRIPE_PLUS_PRICE_ID");
  if (id) {
    try {
      const p = await stripe.prices.retrieve(id);
      return priceIsPlus(p) ? p : null;
    } catch {
      return null;
    }
  }
  const list = await stripe.prices.list({
    lookup_keys: [PLUS_PRICE_LOOKUP_KEY],
    active: true,
    limit: 1,
  });
  const p = list.data[0];
  return p && priceIsPlus(p) ? p : null;
}

async function allEndpoints(stripe: Stripe): Promise<Stripe.WebhookEndpoint[]> {
  const out: Stripe.WebhookEndpoint[] = [];
  for await (const e of stripe.webhookEndpoints.list({ limit: 100 })) out.push(e);
  return out;
}

function webhookStates(
  endpoints: Stripe.WebhookEndpoint[],
  stored: Row[],
  base: string | null,
): WebhookState[] {
  return WEBHOOK_PLANS.map((p) => {
    const url = base ? `${base}${p.path}` : p.path;
    const row = stored.find((r) => r.item === p.item);
    const ours = row ? endpoints.find((e) => e.id === row.object_id) : undefined;
    const vercel = !!env(p.envSecret);
    const ep = ours ?? (vercel ? endpointAt(endpoints, url, p) : undefined);
    const secretFrom = ours && row?.secret_ciphertext ? "setup" : vercel ? "vercel" : null;
    let state: WebhookState["state"];
    if (!ep) state = "missing";
    else if (ep.status !== "enabled") state = "disabled";
    else if (missingEvents(ep.enabled_events, p.events).length) state = "events_missing";
    else if (!secretFrom) state = "no_secret";
    else state = "ok";
    return { item: p.item, label: p.label, url: ep?.url ?? url, state, secretFrom };
  });
}

/** An endpoint already at this address for this plan's events (one Yooits didn't create). */
function endpointAt(endpoints: Stripe.WebhookEndpoint[], url: string, p: WebhookPlan) {
  return endpoints.find(
    (e) =>
      e.url === url &&
      e.metadata?.yooits_setup !== p.item &&
      p.events.some((ev) => e.enabled_events.includes(ev) || e.enabled_events.includes("*")),
  );
}

export async function overview(base: string | null): Promise<StripeOverview> {
  const k = stripeKey();
  const onProduction = env("VERCEL_ENV") === "production";
  const empty: StripeOverview = {
    key: { mode: k?.mode ?? null, onProduction },
    account: null,
    accountError: null,
    connect: { ok: false, note: null },
    plusPrice: { ok: false, id: null },
    portal: { ok: false },
    webhooks: [],
    base,
  };
  if (!k) return empty;
  const stripe = keyOnlyStripe(k.key);
  let account: Stripe.Account;
  try {
    account = await stripe.accounts.retrieveCurrent();
  } catch (e) {
    return { ...empty, accountError: plain(e) };
  }
  const livemode = k.mode === "live";
  const [price, endpoints, stored, connect] = await Promise.all([
    findPrice(stripe).catch(() => null),
    allEndpoints(stripe).catch(() => [] as Stripe.WebhookEndpoint[]),
    rows(livemode).catch(() => [] as Row[]),
    stripe.accounts
      .list({ limit: 1 })
      .then(() => ({ ok: true, note: null }))
      .catch((e) => ({ ok: false, note: plain(e) })),
  ]);
  const portalRow = stored.find((r) => r.item === "portal_configuration");
  let portalOk = !!env("STRIPE_PORTAL_CONFIGURATION_ID");
  if (!portalOk && portalRow) {
    portalOk = await stripe.billingPortal.configurations
      .retrieve(portalRow.object_id)
      .then((c) => c.active)
      .catch(() => false);
  }
  return {
    ...empty,
    account: {
      id: account.id,
      businessName: account.business_profile?.name ?? null,
      displayName: account.settings?.dashboard?.display_name ?? null,
      legalName: account.company?.name ?? null,
      website: account.business_profile?.url ?? null,
      supportEmail: account.business_profile?.support_email ?? account.email ?? null,
      statementDescriptor: account.settings?.payments?.statement_descriptor ?? null,
      country: account.country ?? null,
      chargesEnabled: !!account.charges_enabled,
      payoutsEnabled: !!account.payouts_enabled,
      detailsSubmitted: !!account.details_submitted,
    },
    connect,
    plusPrice: { ok: !!price, id: price?.id ?? null },
    portal: { ok: portalOk },
    webhooks: webhookStates(endpoints, stored, base),
  };
}

// ---------------------------------------------------------------------------
// Set up
// ---------------------------------------------------------------------------
async function store(
  r: Omit<Row, "secret_ciphertext" | "secret_iv"> & { secret?: string },
  key: string,
) {
  const sealed = r.secret ? await sealSecret(r.secret, key) : null;
  const { secret: _drop, ...rest } = r;
  const row = {
    ...rest,
    ...(sealed ? { secret_ciphertext: sealed.ciphertext, secret_iv: sealed.iv } : {}),
    updated_at: new Date().toISOString(),
  };
  const { error } = await db()
    .from("stripe_setup_items")
    .upsert(row, { onConflict: "item,livemode" });
  if (error) throw error;
  secretCache = undefined;
}

/** All active $4.99-a-month USD prices in the account, with their products. */
async function plusLikePrices(stripe: Stripe): Promise<Stripe.Price[]> {
  const out: Stripe.Price[] = [];
  for await (const p of stripe.prices.list({
    active: true,
    type: "recurring",
    currency: PLUS_CURRENCY,
    limit: 100,
    expand: ["data.product"],
  })) {
    if (priceIsPlus(p)) out.push(p);
  }
  return out;
}

/** An existing active Yooits Plus product (ours by metadata, or named Plus). */
async function existingPlusProduct(stripe: Stripe): Promise<Stripe.Product | null> {
  const all: Stripe.Product[] = [];
  for await (const p of stripe.products.list({ active: true, limit: 100 })) all.push(p);
  const oldest = (xs: Stripe.Product[]) => [...xs].sort((a, b) => a.created - b.created)[0];
  return (
    oldest(all.filter((p) => p.metadata?.[PLUS_METADATA_KEY] === PLUS_METADATA_VALUE)) ??
    oldest(all.filter((p) => /\bplus\b/i.test(p.name))) ??
    null
  );
}

export type SelfCheck = { ok: boolean; signedStatus: number | null; badStatus: number | null };

/**
 * Proves the Plus webhook on this site checks Stripe signatures: a harmless
 * event signed with the stored secret must be accepted (200) and the same
 * event with a wrong signature refused (400). The event type is one Yooits
 * ignores, so nothing is stored or changed.
 */
export async function billingWebhookSelfCheck(
  base: string,
  livemode: boolean,
): Promise<SelfCheck | null> {
  const k = stripeKey();
  if (!k) return null;
  const fromEnv = env("STRIPE_BILLING_WEBHOOK_SECRET");
  const secret = fromEnv ?? (await storedWebhookSecrets(["billing_webhook"]))[0];
  if (!secret) return null;
  const stripe = keyOnlyStripe(k.key);
  const crypto = Stripe.createSubtleCryptoProvider();
  const payload = JSON.stringify({
    id: `evt_yooits_self_check_${Date.now()}`,
    object: "event",
    type: "yooits.self_check",
    livemode,
    created: Math.floor(Date.now() / 1000),
    data: { object: {} },
  });
  const header = (sec: string) =>
    stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: sec, cryptoProvider: crypto });
  const send = async (sig: string) => {
    try {
      const r = await fetch(`${base}/api/stripe/billing-webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "stripe-signature": sig },
        body: payload,
      });
      return r.status;
    } catch {
      return null;
    }
  };
  const signedStatus = await send(await header(secret));
  const badStatus = await send(await header(`${secret}x`));
  return { ok: signedStatus === 200 && badStatus === 400, signedStatus, badStatus };
}

/**
 * Makes the Stripe account ready for Yooits Plus, reusing what is already
 * there: an existing $4.99 monthly price, the account's own billing portal
 * settings and any webhook already pointing at Yooits. It creates a piece only
 * when the account has none, and never makes a second price, portal or
 * webhook for the same job. Safe to run again. Returns what it did.
 */
export async function runSetup(base: string, actorUserId: string): Promise<string[]> {
  const k = stripeKey();
  if (!k) throw new Error("There's no Stripe secret key on this site.");
  const stripe = keyOnlyStripe(k.key);
  const livemode = k.mode === "live";
  const account = await stripe.accounts.retrieveCurrent();
  const done: string[] = [];

  // 1. The Plus price: $4.99 a month in USD, found by its lookup key, else reused.
  if (await findPrice(stripe)) {
    done.push("Plus price was already right.");
  } else {
    const chosen = choosePlusPrice(await plusLikePrices(stripe));
    if (chosen) {
      await stripe.prices.update(chosen.id, {
        lookup_key: PLUS_PRICE_LOOKUP_KEY,
        transfer_lookup_key: true,
      });
      done.push(`Reused your existing $4.99 a month Plus price (${chosen.id}).`);
    } else {
      const product =
        (await existingPlusProduct(stripe)) ??
        (await stripe.products.create(
          {
            name: "Yooits Plus",
            description: "Premium customization and no Yooits branding.",
            metadata: { [PLUS_METADATA_KEY]: PLUS_METADATA_VALUE },
          },
          { idempotencyKey: `yooits-plus-product-${account.id}` },
        ));
      await stripe.prices.create(
        {
          product: product.id,
          unit_amount: PLUS_PRICE_CENTS,
          currency: PLUS_CURRENCY,
          recurring: { interval: PLUS_INTERVAL },
          lookup_key: PLUS_PRICE_LOOKUP_KEY,
          transfer_lookup_key: true,
          nickname: "Yooits Plus monthly",
          metadata: { [PLUS_METADATA_KEY]: PLUS_METADATA_VALUE },
        },
        { idempotencyKey: `yooits-plus-price-${account.id}-${PLUS_PRICE_CENTS}` },
      );
      done.push(`Made the Plus price, $4.99 a month, on "${product.name}".`);
    }
  }

  // 2. The billing portal: the one Set up recorded, else the account's own, else a new one.
  const stored = await rows(livemode);
  const portalRow = stored.find((r) => r.item === "portal_configuration");
  const portalParams = portalConfigurationParams(
    base,
  ) as unknown as Stripe.BillingPortal.ConfigurationCreateParams;
  if (env("STRIPE_PORTAL_CONFIGURATION_ID")) {
    done.push("Billing portal is set in Vercel, left as it is.");
  } else if (portalRow) {
    done.push("Billing portal was already set up.");
  } else {
    const configs: Stripe.BillingPortal.Configuration[] = [];
    for await (const c of stripe.billingPortal.configurations.list({ active: true, limit: 100 }))
      configs.push(c);
    const existing =
      configs.find((c) => c.metadata?.yooits_setup === "portal_configuration") ??
      configs.find((c) => c.is_default);
    const cfg = existing ?? (await stripe.billingPortal.configurations.create(portalParams));
    await store(
      {
        item: "portal_configuration",
        livemode,
        stripe_account_id: account.id,
        object_id: cfg.id,
        url: null,
      },
      k.key,
    );
    done.push(
      existing
        ? "Reused your billing portal settings in Stripe."
        : "Made the billing portal settings for Plus.",
    );
  }

  // 3. The Plus webhook (tips and Connect wait until those are switched on).
  const endpoints = await allEndpoints(stripe);
  for (const p of WEBHOOK_PLANS.filter((x) => SETUP_WEBHOOKS.includes(x.item))) {
    const url = `${base}${p.path}`;
    const row = stored.find((r) => r.item === p.item);
    const ours = row?.secret_ciphertext ? endpoints.find((e) => e.id === row.object_id) : undefined;
    const atAddress = endpointsForPlan(endpoints, p).filter((e) => e.url === url);
    const external = env(p.envSecret) ? atAddress[0] : undefined;
    const keep = ours && ours.url === url ? ours : external;
    if (keep) {
      const missing = missingEvents(keep.enabled_events, p.events);
      if (missing.length || keep.status !== "enabled") {
        await stripe.webhookEndpoints.update(keep.id, {
          enabled_events: [
            ...new Set([...keep.enabled_events, ...p.events]),
          ] as Stripe.WebhookEndpointUpdateParams.EnabledEvent[],
          disabled: false,
        });
        done.push(`${p.label} webhook updated.`);
      } else {
        done.push(`${p.label} webhook was already right.`);
      }
      continue;
    }
    if (atAddress.length) {
      // One exists, but Stripe only shows its signing secret once, when it's made.
      done.push(
        `A ${p.label} webhook already points at ${url}, but its signing secret isn't on this site. Add it in Vercel as ${p.envSecret} (Production, Sensitive) and redeploy. No second webhook was made.`,
      );
      continue;
    }
    const created = await stripe.webhookEndpoints.create({
      url,
      connect: p.connect,
      enabled_events: p.events as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
      api_version: Stripe.API_VERSION as Stripe.WebhookEndpointCreateParams.ApiVersion,
      description: `Yooits: ${p.label}`,
      metadata: { yooits_setup: p.item },
    });
    if (!created.secret) throw new Error("Stripe didn't return a signing secret.");
    await store(
      {
        item: p.item,
        livemode,
        stripe_account_id: account.id,
        object_id: created.id,
        url,
        secret: created.secret,
      },
      k.key,
    );
    // Turn off any older endpoint this page made for the same job (kept, not deleted).
    for (const old of endpoints) {
      if (
        old.metadata?.yooits_setup === p.item &&
        old.id !== created.id &&
        old.status === "enabled"
      ) {
        await stripe.webhookEndpoints.update(old.id, { disabled: true });
      }
    }
    done.push(`Made the ${p.label} webhook.`);
  }

  // 4. Prove the webhook checks signatures.
  const check = await billingWebhookSelfCheck(base, livemode);
  done.push(
    !check
      ? "Couldn't check the Plus webhook: no signing secret on this site yet."
      : check.ok
        ? "Plus webhook checked: it accepts Stripe's signature and refuses a wrong one."
        : `Plus webhook check failed (signed ${check.signedStatus ?? "no answer"}, wrong ${check.badStatus ?? "no answer"}).`,
  );

  await db()
    .from("admin_audit_log")
    .insert({
      actor_user_id: actorUserId,
      action: "payments.stripe_setup",
      target_type: "stripe_account",
      target_id: account.id,
      details: {
        livemode,
        steps: done,
        account: {
          business_name: account.business_profile?.name ?? null,
          legal_name: account.company?.name ?? null,
          display_name: account.settings?.dashboard?.display_name ?? null,
          website: account.business_profile?.url ?? null,
          statement_descriptor: account.settings?.payments?.statement_descriptor ?? null,
          country: account.country ?? null,
          charges_enabled: !!account.charges_enabled,
          details_submitted: !!account.details_submitted,
        },
        self_check: check,
      },
    });
  return done;
}
