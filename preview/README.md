# Yooits preview

A private copy of Yooits with everything from PRs #1 to #4, its own test
database and Stripe in test mode. It never touches the live site, the live
database or live payments.

- **Branch:** `preview/yooits` (PRs #1 to #4 combined; `main` is untouched)
- **Address:** `https://yooits-preview.<your-subdomain>.workers.dev`
- **Site password:** the `PREVIEW_PASSWORD` you choose (any user name)
- **Test sign-ins** (same password):
  - `owner@example.com`: admin, opens the Owner console
  - `alice@example.com`: creator with links, a public wishlist and tips ready to connect
  - `bob@example.com`: creator with a private wishlist
  - `casey@example.com`: an account to try suspend and unpublish on

Everything runs on free plans: Supabase Free, Cloudflare Workers Free,
Stripe test mode and GitHub Actions (free for public repositories).

## One-time setup (about 20 minutes, all in accounts you already have)

Pick one long password (12+ characters) for the preview first. It opens the
site and signs in to the test accounts.

### 1. Supabase: a new free project
1. In your Supabase organization, create a new project called `yooits-preview`.
   It's separate from the live project. Free organizations allow two active
   projects; if you're at the limit, pause one you don't use.
2. Copy these (Project Settings, then API Keys, plus the Connect button):
   - Project URL, e.g. `https://abcd1234.supabase.co`
   - Publishable key (or legacy `anon` key)
   - Secret key (or legacy `service_role` key)
   - Connection string: **Session pooler** (works from GitHub), with the
     database password filled in
3. Authentication settings for this project only:
   - Sign In / Providers, Email: turn **Confirm email** off
   - URL Configuration: Site URL `https://yooits-preview.<your-subdomain>.workers.dev`,
     and add `https://yooits-preview.<your-subdomain>.workers.dev/**` to Redirect URLs

### 2. Cloudflare: an API token
1. Workers & Pages: note your `<subdomain>.workers.dev` subdomain (set one up
   if it asks). The preview is a new Worker named `yooits-preview`; nothing
   else in the account is changed.
2. Copy your Account ID (Workers & Pages overview, right-hand side).
3. My Profile, API Tokens, Create Token, template **Edit Cloudflare Workers**,
   limited to your account. Copy the token.

### 3. Stripe: test mode keys
1. Switch Stripe to **Test mode** (or a Sandbox).
2. Developers, API keys: copy the secret key. It must start with `sk_test_`;
   the setup refuses anything else.
3. Connect: if it isn't set up in test mode yet, click Get started and finish
   the platform questions. The two webhooks are created automatically.

### 4. GitHub: store the settings
Repository Settings, Secrets and variables, Actions.

**Secrets:**

| Name | Value |
|---|---|
| `PREVIEW_SUPABASE_URL` | Supabase project URL |
| `PREVIEW_SUPABASE_PUBLISHABLE_KEY` | publishable or anon key |
| `PREVIEW_SUPABASE_SECRET_KEY` | secret or service_role key |
| `PREVIEW_SUPABASE_DB_URL` | Session pooler connection string |
| `PREVIEW_STRIPE_SECRET_KEY` | `sk_test_...` key |
| `PREVIEW_PASSWORD` | your preview password |
| `CLOUDFLARE_API_TOKEN` | Cloudflare token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |

**Variables:** `PREVIEW_DEPLOY` = `on`. This switch allows preview deploys.
Set it to `off` to stop them.

Then ask Claude to start the preview. The first deploy takes about five
minutes and prints the address in the Actions run summary.

## Using it
- Open the address, enter the site password, then sign in with a test account.
- **Tips:** sign in as Alice, connect Stripe from the dashboard (Stripe's
  test onboarding has "use test data" buttons), switch tips on, then tip her
  page with card `4242 4242 4242 4242`, any future date and any CVC.
- **Account controls:** sign in as the owner, open Owner console, Users, Casey.

## Keeping it up to date
Ask Claude to "update the preview". That merges the latest PR branches into
`preview/yooits` (`preview/update-branch.sh`), runs the tests and pushes;
GitHub Actions then migrates the test database and redeploys. New PR branches
go in `preview/branches.txt`.

## Safety checks built in
`preview/deploy.sh` stops before doing anything if:
- any Supabase setting points at the live project
- the Stripe key isn't a test key
- the database address belongs to a different project than the URL
- the finished build contains the live project's id

`STRIPE_LIVE_MODE_APPROVED` is never set, so the app itself also refuses live
keys. Deploys only ever go to the `yooits-preview` Worker.

## Running it from your own computer instead (optional)
Put the same eight values in `preview/preview.env.local` (ignored by git) as
`NAME=value` lines, then run `npm install --legacy-peer-deps` and
`bash preview/deploy.sh`.
