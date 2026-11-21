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

Everything runs in accounts you already have: your Vercel account (through
the Vercel GitHub app that already has access to this repository, so no token),
your Supabase account (one new free project), and GitHub Actions for the
tests. No new accounts and no Namecheap/DNS changes: the preview uses a
`vercel.app` address. Stripe is optional (tipping stays off without it).

**What the live site uses today** (from the repository): one Supabase project,
`oaeakgchijurkssjdxui`, for the database, sign-in (email and password) and file
storage (one public bucket, `avatars`, for profile photos). It was created by
Lovable and is most likely Lovable Cloud rather than a project in your own
Supabase account. The preview never uses it: the build refuses that project.

**How deploys work:** Vercel builds only `preview/yooits`. Its build command
(`deploy/vercel-build.sh`, set in `vercel.json` and in the project settings)
checks the settings, loads the test accounts through Supabase's API and builds
Yooits without Lovable. It never connects to the database, so it needs no
database connection string: the migrations in `supabase/migrations` are applied
to the preview project separately (by Claude through the Supabase connector, or
with `bash deploy/deploy.sh preview` and `SUPABASE_DB_URL` from a computer). `main` and the PR branches don't have that script, so they
can't build there, and the Ignored Build Step skips them anyway. After each
deploy, GitHub Actions runs the end-to-end tests (`.github/workflows/e2e.yml`).
`deploy/deploy.sh` can also deploy with a Vercel token instead (kept for later).

**About Vercel's free plan:** Vercel's terms limit the free Hobby plan to
"personal or non-commercial use". Yooits takes payments, so production on
Vercel needs a paid plan (Pro). The terms don't mention testing; using Pro
from the start avoids the question. Your choice; the setup is the same.

**Site password and test accounts (from 2026-11-21):** this Vercel project
now also serves yooits.me. The site password is on only while `SITE_PASSWORD`
is set in Vercel; remove it to open the site. The example.com test accounts
load only when Vercel has `SEED_TEST_ACCOUNTS=true` (which also needs
`SITE_PASSWORD`, their password). The end-to-end tests run only when started
by hand in GitHub Actions.

## One-time setup (about 10 minutes)

Pick one long password (12+ characters) for the preview first. It opens the
site and signs in to the test accounts.

### 1. Supabase: a new free project
In your Supabase dashboard:
1. New project, name `yooits-preview`. Free organizations allow two active
   projects; if you're at the limit, pause one you don't use.
2. Copy: the Project URL, the publishable key (or `anon`), the secret key (or
   `service_role`) from Project Settings, API Keys; and the **Session pooler**
   connection string from the Connect button, with the database password in it.
3. Authentication, Sign In / Providers, Email: turn **Confirm email** off.

### 2. Vercel: import the repository
1. In Vercel, Add New, Project, and import `cm4all88/social-web-card`.
2. Project name `yooits-preview`. Under Build and Output Settings, override
   **Build Command** with `bash deploy/vercel-build.sh`.
3. Environment Variables: paste this block with your values filled in:
   ```
   SUPABASE_URL=
   SUPABASE_PUBLISHABLE_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   SITE_PASSWORD=
   ```
   Every value is checked at the start of the build, and the build stops with
   the name of anything missing or wrong (never its value). The names the
   Supabase–Vercel integration sets (`SUPABASE_ANON_KEY`,
   `NEXT_PUBLIC_SUPABASE_URL`, ...) work too.
4. Click Deploy. This first deploy is of `main` and **fails on purpose**
   ("only preview/yooits deploys to this project"), so nothing goes live.
5. Project Settings, **Environments**, Production, Branch Tracking: change the
   branch to `preview/yooits` and save.
6. Project Settings, **Build and Deployment**, Ignored Build Step: choose
   **Only build production**, so `main` and the PR branches are skipped.

### 3. GitHub: the password for the tests
Repository Settings, Secrets and variables, Actions, New repository secret:
`SITE_PASSWORD` = your preview password.

Then tell Claude it's done. The next push to `preview/yooits` deploys the
preview and runs the tests. If Vercel gave the project another address than
`https://yooits-preview.vercel.app`, add a repository variable `PREVIEW_URL`
with it (Claude can tell you).

Tipping later: add `STRIPE_SECRET_KEY` (an `sk_test_` key) and
`TIPPING_ENABLED=true` in Vercel's Environment Variables; the Stripe webhooks
then need one more step.

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
new migrations are applied to the preview project, then Vercel redeploys. New PR branches
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
