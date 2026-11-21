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

Everything runs in accounts you control (not Lovable's): Vercel, Supabase Free,
Stripe test mode and GitHub Actions (free for public repositories).

**About Vercel's free plan:** Vercel's terms limit the free Hobby plan to
"personal or non-commercial use". Yooits takes payments, so production on
Vercel needs a paid plan (Pro). The terms don't mention testing; using Pro
from the start avoids the question. Your choice; the setup is the same.

## One-time setup (about 20 minutes)

Pick one long password (12+ characters) for the preview first. It opens the
site and signs in to the test accounts.

### 0. Check what Lovable manages (2 minutes, changes nothing)
In the Yooits project in Lovable:
- Click the **Cloud** icon on the top bar. If you see **Database** and
  **Users** screens inside Lovable, the live database is Lovable Cloud and
  isn't in any Supabase account of yours. If you see a Supabase project name
  with links to the Supabase Dashboard, it's your own Supabase project.
- **Project > Settings > Domains**: if yooits.me is listed, Lovable hosts
  the live site.

Either way the preview uses its own new database, so nothing here touches
the live one.

### 1. Vercel: an account and a token
Sign up or sign in at vercel.com (signing up with GitHub is quickest).
You don't need to import the repository: the deploy creates a Vercel
project called `yooits-preview` itself and changes nothing else.
1. Account Settings, **Tokens**: create a token (any name, e.g. "Yooits
   deploys"), scoped to your account, and copy it. Vercel shows it once.
2. Only if you use a Vercel *team* rather than your personal account: note the
   team's slug (in its URL) for step 4.

### 2. Supabase: a new free project
Sign in at supabase.com (or sign up free; with Lovable Cloud you may not have
an account yet).
1. Create a new project called `yooits-preview`. Free organizations allow two
   active projects; if you're at the limit, pause one you don't use.
2. Copy these (Project Settings, then API Keys, plus the Connect button):
   - Project URL, e.g. `https://abcd1234.supabase.co`
   - Publishable key (or legacy `anon` key)
   - Secret key (or legacy `service_role` key)
   - Connection string: **Session pooler** (works from GitHub), with the
     database password filled in
3. Authentication settings for this project only:
   - Sign In / Providers, Email: turn **Confirm email** off
   - URL Configuration: Site URL `https://yooits-preview.vercel.app`, and add
     `https://yooits-preview*.vercel.app/**` to Redirect URLs (the `*` also
     covers the address Vercel uses if the plain name is taken)

### 3. Stripe: test mode keys
Sign in to Stripe (or create a free account; test mode works before any
business verification).
1. Switch Stripe to **Test mode** (or a Sandbox).
2. Developers, API keys: copy the secret key. It must start with `sk_test_`;
   the setup refuses anything else.
3. Connect: if it isn't set up in test mode yet, click Get started and finish
   the platform questions. The two webhooks are created automatically.

### 4. GitHub: store the settings
You need to be an owner of the `cm4all88/social-web-card` repository.
Each environment keeps its own settings, so production can later get its own
set without touching the preview's.

1. Repository Settings, **Environments**, New environment, name it `preview`.
2. In the `preview` environment, **Environment secrets**, add:

| Name | Value |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | publishable or anon key |
| `SUPABASE_SECRET_KEY` | secret or service_role key |
| `SUPABASE_DB_URL` | Session pooler connection string |
| `STRIPE_SECRET_KEY` | `sk_test_...` key |
| `SITE_PASSWORD` | your preview password |
| `VERCEL_TOKEN` | Vercel token |
| `BACKUP_PASSPHRASE` | optional: a long passphrase (16+ characters) that encrypts backups. Keep a copy somewhere safe; backups can't be opened without it. |

3. Repository Settings, Secrets and variables, Actions, **Variables** tab,
   New repository variable: `PREVIEW_DEPLOY` = `on`. This switch allows
   preview deploys. Set it to `off` to stop them. (Team accounts only: also
   add `VERCEL_SCOPE` = your team's slug.)

Then ask Claude to start the preview. The first deploy takes about five
minutes and prints the address in the Actions run summary.

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
