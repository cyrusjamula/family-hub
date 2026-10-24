# Source and deployments

The intended pipeline is a public GitHub source repository → Cloudflare Workers Builds → validation → deployment of the existing Worker. Cloudflare Workers Free build allowance is used; no paid plan or overage is authorized. No GitHub Actions runner is needed for this pipeline.

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

`ci` checks JavaScript syntax, security-critical deployment settings, the full test suite, generated asset consistency through regeneration, and a Wrangler bundle dry-run. `deploy` runs `ci` itself and invokes the local pinned Wrangler with `--keep-vars` only after validation succeeds. A failure, signal, or spawn error prevents that deployment invocation. The native build command also runs validation; this intentional repetition keeps the deployment command safe when dashboard settings drift. Do not enable a second deployment workflow for the same branch.

The `Validate Family Hub` GitHub Actions workflow runs the same checks on pull requests and `main`. It uses standard public-repository runners, read-only repository access, pinned action revisions, and no deployment or runtime secrets. It performs no deployment, provider writes, or AI calls. It does not replace the native Cloudflare deployment pipeline. Branch protection must separately require its `validate` job; workflow presence alone does not enforce merge rules.

## Secrets and access

Google client credentials, refresh tokens, vault key and push signing key stay in existing Cloudflare runtime secrets/D1. Never put them in GitHub files, Actions variables, build logs, screenshots, or repository history. Builds do not need Google runtime credentials. Cloudflare deploy authentication belongs only in the native build integration. Grant the GitHub integration this repository only where supported. Creating a deployment credential requires owner authorization at setup time.

The existing D1 binding, AI binding, runtime settings, protected workers.dev URL and 15-minute cron are retained. Preview URLs stay disabled. Signed Access JWT validation continues to fail closed even before any Google/AI call. Cloudflare Access policy and Google folder/calendar ACLs are managed outside this repository and must remain restricted.

## Change process

Work on a branch and open a PR. Run `npm ci` and `npm run ci` before merging. The native production pipeline validates `main` again before deploying. PR-specific CI/status enforcement and branch rules must be verified separately; do not claim they exist from this document alone. A solo owner can merge without another person's approval unless a ruleset is separately configured. Application approvals for sending emails/calendar events remain mandatory regardless of deployment automation.

Database migrations are versioned in `migrations/` but are not automatically run by the deploy command. Migrations 0001–0005 were previously applied to the existing D1 database. Migration 0006 adds identity-attempt provenance and must be reviewed/applied before deploying the alias-support change; it has not been live-applied by these code changes. Review schema changes and backup/recovery before running `npm run migrate:production`; do not apply destructive migrations implicitly. This avoids granting routine builds unnecessary D1 mutation authority. See [identity rollout](IDENTITY.md).

## Recovery and verification

Keep the last healthy Cloudflare deployment version. If a deployment fails, inspect build logs without printing credentials. A failed build must leave the active version intact. Use Cloudflare Deployments → Rollback to the previous healthy version if needed; rollback does not undo schema changes.

After first deployment verify: build log passes all tests; deployed commit matches `main`; anonymous requests require Access; owner login works; live Google status remains connected; existing data and pending approval actions remain; no email, booking or calendar mutation occurs as part of a build.

## Setup status

The source repository is public by owner choice; the live hub remains protected. The reviewed baseline is merged in PR #2. Cloudflare GitHub integration was previously connected for this repository, but builds were last observed disabled. On this follow-up, the dashboard stopped at a site-served bot security verification page, so current build configuration and the active source commit could not be verified. First verified native build, deployment SHA, failing-build demonstration in the native pipeline, and post-deployment live smoke tests remain pending in issue #3. Local automated tests of the deployment gate are separate from that live evidence.

