# Source and deployments

The intended pipeline is a private GitHub repository → Cloudflare Workers Builds → validation → deployment of the existing Worker. Cloudflare Workers Free build allowance is used; no paid plan or overage is authorized. No GitHub Actions runner is needed for this pipeline.

## Build configuration

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `/` |
| Install | `npm ci` (automatic package-lock detection) |
| Node | `24` via build environment `NODE_VERSION` |
| Build command | `npm run ci` |
| Deploy command | `npm run deploy` |
| Non-production/preview builds | Disabled |

`ci` checks JavaScript syntax, security-critical deployment settings, the full test suite, generated asset consistency through regeneration, and a Wrangler bundle dry-run. Failed validation prevents deployment. `deploy` uses the local pinned Wrangler and `--keep-vars`. Do not enable a second deployment workflow for the same branch.

## Secrets and access

Google client credentials, refresh tokens, vault key and push signing key stay in existing Cloudflare runtime secrets/D1. Never put them in GitHub files, Actions variables, build logs, screenshots, or repository history. Builds do not need Google runtime credentials. Cloudflare deploy authentication belongs only in the native build integration. Grant the GitHub integration this repository only where supported. Creating a deployment credential requires owner authorization at setup time.

The existing D1 binding, AI binding, runtime settings, protected workers.dev URL and 15-minute cron are retained. Preview URLs stay disabled. Signed Access JWT validation continues to fail closed even before any Google/AI call. Cloudflare Access policy and Google folder/calendar ACLs are managed outside this repository and must remain restricted.

## Change process

Work on a branch and open a PR. Run `npm ci` and `npm run ci` before merging. The native production pipeline validates `main` again before deploying. PR-specific CI/status enforcement and branch rules must be verified separately; do not claim they exist from this document alone. A solo owner can merge without another person's approval unless a ruleset is separately configured. Application approvals for sending emails/calendar events remain mandatory regardless of deployment automation.

Database migrations are versioned in `migrations/` but are not automatically run by the deploy command. Current migrations 0001–0005 were already applied to the existing D1 database. Review schema changes and backup/recovery before running `npm run migrate:production`; do not apply destructive migrations implicitly. This avoids granting routine builds unnecessary D1 mutation authority.

## Recovery and verification

Keep the last healthy Cloudflare deployment version. If a deployment fails, inspect build logs without printing credentials. A failed build must leave the active version intact. Use Cloudflare Deployments → Rollback to the previous healthy version if needed; rollback does not undo schema changes.

After first deployment verify: build log passes all tests; deployed commit matches `main`; anonymous requests require Access; owner login works; live Google status remains connected; existing data and pending approval actions remain; no email, booking or calendar mutation occurs as part of a build.

## Setup status

Repository Private verified and Cloudflare GitHub integration connected for this repository. Pipeline source is being uploaded; builds remain disabled until that succeeds. First native build and live smoke verification remain pending.
