/**
 * Creates the two TEST-mode Stripe webhook endpoints for the preview site
 * (one for the platform, one for connected accounts) and prints their signing
 * secrets as JSON on stdout for deploy/deploy.sh to store as Worker secrets.
 * Refuses live keys. Never deletes anything.
 */
import Stripe from "stripe";
import { readFileSync } from "node:fs";

const key = process.env.STRIPE_SECRET_KEY ?? "";
const site = process.env.SITE_URL ?? "";
if (!/^(sk|rk)_test_/.test(key)) {
  console.error("stripe: only a Stripe TEST key (sk_test_...) is allowed for the preview");
  process.exit(1);
}
if (!/^https:\/\/[^/]+$/.test(site)) {
  console.error("stripe: SITE_URL must be the preview's https address");
  process.exit(1);
}

// Same event list the webhook handler accepts.
const source = readFileSync(new URL("../src/lib/tipping/webhook-handler.ts", import.meta.url), "utf8");
const block = source.match(/HANDLED_EVENT_TYPES = \[([\s\S]*?)\]/);
const events = block ? [...block[1].matchAll(/"([a-z_.]+)"/g)].map((m) => m[1]) : [];
if (events.length === 0) {
  console.error("stripe: couldn't read the webhook event list");
  process.exit(1);
}

const stripe = new Stripe(key);
const url = `${site}/api/stripe/webhook`;
const existing = await stripe.webhookEndpoints.list({ limit: 100 });
if (existing.data.some((e) => e.url === url)) {
  console.error(
    `stripe: test webhooks for ${url} already exist but their secrets aren't stored on the preview. ` +
      "Delete those two endpoints in Stripe (test mode, Developers > Webhooks) and run the deploy again.",
  );
  process.exit(1);
}
const platform = await stripe.webhookEndpoints.create({
  url,
  enabled_events: events,
  description: `Yooits ${process.env.YOOITS_ENV ?? "preview"} (platform)`,
});
const connect = await stripe.webhookEndpoints.create({
  url,
  enabled_events: events,
  connect: true,
  description: `Yooits ${process.env.YOOITS_ENV ?? "preview"} (connected accounts)`,
});
if (platform.livemode || connect.livemode) {
  console.error("stripe: refusing, Stripe reports live mode");
  process.exit(1);
}
process.stdout.write(
  JSON.stringify({ STRIPE_WEBHOOK_SECRET: platform.secret, STRIPE_CONNECT_WEBHOOK_SECRET: connect.secret }),
);
console.error(`stripe: created test webhooks for ${url}`);
