# Yooits preview (and, later, production)

A private copy of Yooits with everything from PRs #1 to #4, its own test
database and Stripe in test mode. It never touches the live site, the live
database or live payments.

It's built as the first copy of Yooits's own hosting, not a throwaway: the
same scripts deploy a future production site from different settings
(`deploy/environments/`), with database migrations and encrypted backups.
How the live site would later move off Lovable: `deploy/MIGRATION.md`.

- **Branch:** `preview/yooits` (PRs #1 to #4 combined; `main` is untouched)
- **Address:** `https://yooits-preview.vercel.app` (Vercel adds a suffix if that name is taken; the deploy prints the real one)
- **Site password:** the `SITE_PASSWORD` you choose (any user name)
- **Test sign-ins** (same password):
  - `owner@example.com`: admin, opens the Owner console
  - `alice@example.com`: creator with links, a public wishlist and tips ready to connect
  - `bob@example.com`: creator with a private wishlist
  - `casey@example.com`: an account to try suspend and unpublish on

Everything runs in accounts you already have: your Vercel account, your
Supabase account (free project), Stripe test mode and GitHub Actions (free for
public repositories). No new accounts and no Namecheap/DNS changes: the
preview uses a `vercel.app` address.

**Why a token and not "Import Git Repository":** the Vercel and Supabase GitHub
apps already have access to this repository, but importing it in Vercel would
build `main` and every PR branch automatically, with Lovable's build setup and
no database migrations. The token lets GitHub Actions deploy only
`preview/yooits`, run the migrations and test the result.

**About Vercel's free plan:** Vercel's terms limit the free Hobby plan to
"personal or non-commercial use". Yooits takes payments, so production on
Vercel needs a paid plan (Pro). The terms don't mention testing; using Pro
from the start avoids the question. Your choice; the setup is the same.

## One-time setup (about 10 minutes)

Pick one long password (12+ characters) for the preview first. It opens the
site and signs in to the test accounts.

### 1. Vercel: a token
In your existing Vercel account: Account Settings, **Tokens**, create a token
(e.g. "Yooits deploys"), scope it to the team your other projects are in, set
an expiry if you like, and copy it. Vercel shows it once. The deploy creates a
project called `yooits-preview` and changes nothing else in your account.
If the first deploy reports a scope error, add a repository variable
`VERCEL_SCOPE` with that team's slug (the name in its Vercel URL).

### 2. Supabase: a new free project
In your existing Supabase account:
1. Create a new project called `yooits-preview`. Free organizations allow two
   active projects; if you're at the limit, pause one you don't use.
2. Copy these (Project Settings, then API Keys, plus the Connect button):
   - Project URL, e.g. `https://abcd1234.supabase.co`
   - Publishable key (or legacy `anon` key)
   - Secret key (or legacy `service_role` key)
   - Connection string: **Session pooler** (works from GitHub), with the
     database password filled in
3. Authentication, Sign In / Providers, Email: turn **Confirm email** off
   (for this project only; the sign-up test needs it). Optionally, URL
   Configuration: Site URL `https://yooits-preview.vercel.app` and Redirect
   URL `https://yooits-preview*.vercel.app/**` (password reset links).

### 3. Stripe (optional, for tipping)
Without a Stripe key the preview runs with tipping switched off; add it any
time later. In Stripe **Test mode**: Developers, API keys, copy the secret key
(`sk_test_...`; anything else is refused). If Connect isn't set up in test
mode, click Get started there. The webhooks are created automatically.

### 4. GitHub: store the settings
Repository Settings, **Environments**, New environment `preview`, then
**Environment secrets**:

| Name | Value |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | publishable or anon key |
| `SUPABASE_SECRET_KEY` | secret or service_role key |
| `SUPABASE_DB_URL` | Session pooler connection string |
| `SITE_PASSWORD` | your preview password |
| `VERCEL_TOKEN` | Vercel token |
| `STRIPE_SECRET_KEY` | optional: `sk_test_...` key |
| `BACKUP_PASSPHRASE` | optional: a long passphrase (16+ characters) that encrypts backups. Keep a copy somewhere safe. |

Then tell Claude the secrets are in. Each push to `preview/yooits` migrates
the test database, deploys, and runs the end-to-end tests in `e2e/` (sign-up,
public pages, creator dashboard, owner console and account controls). The
Actions run summary shows the address. To pause deploys, add a repository
variable `PREVIEW_DEPLOY` = `off`.

## Using it
- Open the address, enter the site password, then sign in with a test account.
- If Vercel asks you to log in to Vercel before the site password, its
  Deployment Protection is on for this project: turn it off in the
  `yooits-preview` project's Settings, Deployment Protection. The site
  password still protects the preview, and Stripe can't reach a page that
  asks for a Vercel login.
- **Tips:** sign in as Alice, connect Stripe from the dashboard (Stripe's
  test onboarding has "use test data" buttons), switch tips on, then tip her
  page with card `4242 4242 4242 4242`, any future date and any CVC.
- **Account controls:** sign in as the owner, open Owner console, Users, Casey.

## Keeping it up to date
Ask Claude to "update the preview". That merges the latest PR branches into
`preview/yooits` (`deploy/update-branch.sh`), runs the tests and pushes;
GitHub Actions then migrates the test database and redeploys. New PR branches
go in `deploy/branches.txt`.

## Backups
Actions, **Back up Yooits**, Run workflow, `preview`: saves an encrypted copy
of the database (accounts included) and every uploaded file, kept for 30
days. Needs `BACKUP_PASSPHRASE`. Production will back up daily and before
every deploy, but never into a public repository, because anyone signed in
to GitHub can download its backups (see `deploy/MIGRATION.md`).

## Safety checks built in
`deploy/deploy.sh <environment>` stops before doing anything if:
- any Supabase setting points at the database Lovable runs the live site on
  (in every environment, production included)
- the Stripe key is a live key and live payments aren't approved for that environment
- the database address belongs to a different project than the URL
- test data would go anywhere but the preview
- the finished build contains the live database's id, or not this environment's

`STRIPE_LIVE_MODE_APPROVED` is never set, so the app itself also refuses live
keys. Production deploys are switched off (`PRODUCTION_DEPLOY` isn't set),
run only by hand from `main`, and only from a private repository.

## Running it from your own computer instead (optional)
Put the same values in `deploy/environments/preview.secrets.local` (ignored
by git) as `NAME=value` lines, then run `npm install --legacy-peer-deps` and
`bash deploy/deploy.sh preview`. Add `DRY_RUN=1` in front to check the
settings and build without changing anything.
