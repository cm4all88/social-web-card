# Leaving Lovable: how Yooits moves to its own hosting

**Status: plan only.** Nothing here has been run. The live site stays on
Lovable, unchanged, until Chris approves a migration date. No DNS changes.

## The target

The preview is built as the first copy of the final setup, not a stand-in:

| Part | Preview (now) | Production (after the move) |
| --- | --- | --- |
| Hosting | Cloudflare Worker `yooits-preview` | Cloudflare Worker `yooits` on yooits.me |
| Database, sign-in, files | Supabase project `yooits-preview` | a new Supabase project `yooits-production` |
| Settings | `deploy/environments/preview.env` + GitHub environment `preview` | `deploy/environments/production.env` + GitHub environment `production` (with required approval) |
| Deploys | every push to `preview/yooits` | by hand from `main`, after approval |
| Database changes | `supabase/migrations`, applied by `deploy.sh` | same, with an encrypted backup first |
| Backups | `deploy/backup.sh` on demand | daily (`backup.yml`), plus before every deploy |
| Payments | Stripe test mode | Stripe live mode, only once approved |

Same code, same scripts; only the settings differ. The build already runs
without Lovable (`vite.config.standalone.ts` produces the same output as
Lovable's build, checked file by file).

## What depends on Lovable today

- **Hosting and deploys:** Lovable builds and serves the live site.
- **Database, accounts and files:** most likely Lovable Cloud (Lovable's managed
  Supabase). Confirm with the Cloud icon check in `deploy/README.md`, Step 0.
- **Code:** only the build wrapper `@lovable.dev/vite-tanstack-config`. Leaving
  means renaming `vite.config.standalone.ts` to `vite.config.ts` and removing
  that package. No Lovable sign-in, AI or other services are used in the app.
- **Domain:** yooits.me is presumably connected in Lovable (Project → Settings → Domains). Not verified.

## What moves, and how (if the live backend is Lovable Cloud)

From Lovable's own docs ("external deployment and hosting"):

- **Database and user accounts:** Lovable's export (More → Database → Manage →
  Settings → Export project data → Database → Export) gives one PostgreSQL
  backup file with all tables plus the `auth` schema. It includes password
  hashes, so **people keep their passwords**. Everyone has to sign in once
  more after the move. Third-party guides say exports are limited to one
  per 24 hours.
- **Uploaded files (avatars):** not in the export. The avatars bucket is public,
  and the export lists every file (`storage.objects`), so each file can be
  copied by its public address without any Lovable key. Same folder and file
  names in the new project.
- **Settings Lovable holds:** sign-in settings (site address, redirect
  addresses, email templates, whether emails must be confirmed) and any
  secrets. These are re-entered by hand.

Things specific to Yooits that the move must handle:

1. **Avatar addresses:** `profiles.avatar_url` stores the full file address,
   which includes the old project's id. After copying files, one update swaps
   the old host for the new one. Nothing else stores Supabase addresses
   (wishlist images are external links).
2. **Schema order:** live has 7 migrations; this branch adds 4 (tipping and
   wishlists, security hardening, dashboard, account controls). Restore the
   live data into a project at the *same* 7 migrations, then apply the 4 new
   ones. The new rules were written to apply to new edits only, so old data
   that breaks them still restores.
3. **Sign-in emails:** Lovable sends them today. Supabase's built-in email is
   only for testing, so production needs its own email sender (custom SMTP,
   see https://supabase.com/docs/guides/auth/auth-smtp) before the move.
4. **No scheduled jobs, Vault secrets, extensions or edge functions** are used,
   so none of the usual traps for those apply.

## Order of the move (later, after approval)

1. **Prepare (any time, no risk):** production Supabase project, email sender,
   Stripe live account if payments are approved by then, and one decision on
   where production backups live (below).
2. **Rehearse:** Lovable export → restore into a throwaway Supabase project →
   copy avatars → fix addresses → apply new migrations → deploy to a
   workers.dev address → check account, page and file counts against live and
   sign in with your own account. Delete the throwaway project after.
3. **Move day:** pause edits on the live site → fresh Lovable export (it's a
   snapshot, so it must be taken at the start of the move) → repeat the
   rehearsed steps into `yooits-production` → test on its workers.dev address.
4. **Switch the domain:** point yooits.me at the Cloudflare Worker. Lovable's
   lovable.app address keeps serving the old version, which is the fallback.
5. **After a quiet week:** unpublish on Lovable, keep the export file safe,
   and only then remove Lovable Cloud. Lovable's docs warn that removing it
   deletes its backups, accounts and files permanently.

### Decision for later: where production backups live

Backups hold user accounts, and anyone signed in to GitHub can download a
public repository's workflow artifacts. On GitHub's free plan, private
repositories get no per-environment secrets and no required approvals
(GitHub's "deployments and environments" docs). So production needs one of:

- **GitHub Pro (paid) and a private repository:** the workflows run as written.
- **Stay public and free:** keep the `production` environment with a required
  reviewer, and send backups to a private Cloudflare R2 bucket instead of
  GitHub (a small workflow change, made when we get there).

The preview isn't affected: it only holds test data.

## If the check shows your own Supabase project instead

Then the live data is already in your account and nothing needs copying.
The move is hosting only: add the production site address to Supabase's
redirect list, deploy the Worker, switch the domain, disconnect Lovable.
`deploy.sh` refuses the live database in every environment today; that
guard would be lifted for production only, as part of the approved move.

## Restoring a backup

`deploy/backup.sh <env>` makes `backups/yooits-<env>-<time>.tar.gz.gpg`.
To restore into an empty Supabase project (tested locally on 2026-11-19
with a full round trip: accounts, profiles, migration history and all 45
access rules came back):

```
gpg -d yooits-<env>-<time>.tar.gz.gpg | tar -xz
cd yooits-<env>-<time>
psql "$NEW_DB_URL" --single-transaction -v ON_ERROR_STOP=1 \
  -f schema.sql -c 'SET session_replication_role = replica' -f data.sql \
  -f history_schema.sql -f history_data.sql
```

Then upload `storage/files/<bucket>/...` to the same buckets and paths
(`storage/storage-manifest.json` lists them), and fix avatar addresses if
the project changed.
