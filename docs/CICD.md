# Source and deployments

The intended pipeline is a public GitHub source repository → Cloudflare Workers Builds → validation → deployment of the existing Worker. Cloudflare Workers Free build allowance is used; no paid plan or overage is authorized. No GitHub Actions runner is needed for this pipeline.

## Build configuration

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `/` |
| Install | `npm ci` (automatic package-lock detection) |
| Node | `26.12.1` via `.nvmrc` and matching build environment `NODE_VERSION` |
| Build command | `npm run ci` |
| Deploy command | `npm run deploy` |
| Non-production/preview builds | Disabled |

`ci` checks JavaScript syntax, security-critical deployment settings, the full test suite, generated asset consistency through regeneration, and a Wrangler bundle dry-run. `deploy` runs `ci` itself and invokes the local pinned Wrangler with `--keep-vars` only after validation succeeds. A failure, signal, or spawn error prevents that deployment invocation. CLI flags are forwarded only to Wrangler; `npm run deploy -- --dry-run` remains a dry run. The native build command also runs validation; this intentional repetition keeps the deployment command safe when dashboard settings drift. Do not enable a second deployment workflow for the same branch.

The `Validate Family Hub` GitHub Actions workflow runs the same checks on pull requests and `main`. It uses standard public-repository runners, read-only repository access, pinned action revisions, and no deployment or runtime secrets. It performs no deployment, provider writes, or AI calls. It does not replace the native Cloudflare deployment pipeline. Branch protection must separately require its `validate` job; workflow presence alone does not enforce merge rules.

## Secrets and access

Google client credentials, refresh tokens, vault key and push signing key stay in existing Cloudflare runtime secrets/D1. Never put them in GitHub files, Actions variables, build logs, screenshots, or repository history. Builds do not need Google runtime credentials. Cloudflare deploy authentication belongs only in the native build integration. Grant the GitHub integration this repository only where supported. Creating a deployment credential requires owner authorization at setup time.

The existing D1 binding, AI binding, runtime settings, protected workers.dev URL and 15-minute cron are retained. Preview URLs stay disabled. Signed Access JWT validation continues to fail closed even before any Google/AI call. Cloudflare Access policy and Google folder/calendar ACLs are managed outside this repository and must remain restricted.

## Change process

Work on a branch and open a PR. Run `npm ci` and `npm run ci` before merging. The native production pipeline validates `main` again before deploying. PR-specific CI/status enforcement and branch rules must be verified separately; do not claim they exist from this document alone. A solo owner can merge without another person's approval unless a ruleset is separately configured. Application approvals for sending emails/calendar events remain mandatory regardless of deployment automation.

### Auto-merge after Copilot review

The `Auto-merge after Copilot review` workflow maintains a `copilot-review` check on each pull request's current head commit. Require this check from GitHub Actions in the default-branch ruleset alongside `validate`. A non-dismissed `COMMENTED` or `APPROVED` review from `copilot-pull-request-reviewer[bot]` on that exact commit passes the check and enables squash auto-merge. Drafts, new commits awaiting review, dismissed reviews and change requests remain blocked. Existing validation, CodeQL, code-quality and conversation-resolution requirements still apply; completing a Copilot review does not bypass them or count as human approval.

Review events run an unprivileged notification workflow. Its completion triggers reconciliation using only trusted base/default-branch source, not PR code or downloaded artifacts. PR lifecycle events also reconcile the gate; new head commits require their own review. API errors fail visibly. The privileged workflow uses the built-in Actions token with repository-content, pull-request and check write permissions, without deployment credentials or AI calls. A manual dispatch reconciles existing open PRs after installation or recovery.

Database migrations are versioned in `migrations/` but are not automatically run by the deploy command. Migrations 0001–0005 were previously applied to the existing D1 database. Migration 0006 adds identity-attempt provenance and must be reviewed/applied before deploying the alias-support change; it has not been live-applied by these code changes. Review schema changes and backup/recovery before running `npm run migrate:production`; do not apply destructive migrations implicitly. This avoids granting routine builds unnecessary D1 mutation authority. See [identity rollout](IDENTITY.md).

## Recovery and verification

Keep the last healthy Cloudflare deployment version. If a deployment fails, inspect build logs without printing credentials. A failed build must leave the active version intact. Use Cloudflare Deployments → Rollback to the previous healthy version if needed; rollback does not undo schema changes.

After first deployment verify: build log passes all tests; deployed commit matches `main`; anonymous requests require Access; owner login works; live Google status remains connected; existing data and pending approval actions remain; no email, booking or calendar mutation occurs as part of a build.

## Verification evidence (2026-10-23, Pacific time)

The native GitHub-to-Cloudflare pipeline is enabled. It builds `main` with Node 26.12.1, root `/`, build `npm run ci` and deploy `npm run deploy`. Production preview URLs are disabled, and the production URL has a Cloudflare Access policy. The active default-branch GitHub ruleset requires `validate` from GitHub Actions, an up-to-date branch, a pull request and resolved conversations; CodeQL gates also apply. The existing Dependabot PR-only bypass remains. The required review count is zero, so owner review is still a process requirement rather than an independently enforced reviewer count.

| Check | Observed evidence |
| --- | --- |
| Successful reviewed source | Main `3bd4b20a5a2be3a031a7604badef5ab5710a28d0`; native build `062652a1-8524-4fc4-9f08-34308d8e77e6`; production version `ce5c796b` at 100% in rollout history |
| Full regression/build checks | [GitHub validation](https://github.com/cyrusjamula/family-hub/actions/runs/40070037542) and [Cloudflare Workers Builds status](https://github.com/cyrusjamula/family-hub/runs/120801437832) passed on that source |
| Native failure stops deployment | Build `01e4f712-8d7b-4405-bf9a-af5a3ef2d35e` on `c1e9eeac04d895e28fe35836499b060bf37a5813` ran with Node 24.22.1, failed the runtime-version regression assertion in `npm run ci`, and never entered deployment or produced a Worker version |
| Authenticated owner smoke | Expected owner role; Chat, Plan & approvals, Settings and Advanced loaded; existing Google connection remained connected; both Drive roots passed metadata-only checks; existing Family calendar read succeeded |
| Anonymous protection | Before owner sign-in, the production URL presented the Access login screen rather than app content; the Domains screen confirms an Access policy and disabled preview URLs |
| Room draft isolation | An unsent synthetic Family draft was absent in Parents private, returned in Family and was cleared without submission |

The native failure above is an actual CI runtime-assertion failure, not a deliberately injected failing application test on production. `test/deploy-integration.test.js` separately exercises the real deployment entry point and real npm/test subprocesses with passing and failing synthetic suites. A local executable replaces Wrangler; the child receives no provider credentials and npm is offline. Failure must exit before the local Wrangler boundary; success must reach it exactly once with `--keep-vars`. These tests complement the existing exit/signal/spawn-error and argument-forwarding coverage.

No deliberate broken source, production failure, rollback, schema migration, email/calendar mutation or AI request was introduced to collect this evidence. Owner smoke tests do not complete the other members' role/alias tests (#4/#5), device tests (#7), private-record consent tests (#8), unattended jobs (#9), telemetry rollout (#14) or feedback rollout.

## Rollback and migration runbook

1. Record the active version, its source SHA and the prior known-good version before a release. Keep the validated source available. A listed Ready version is not proof that it serves production traffic; check the active deployment and traffic allocation.
2. If a build or CI check fails, leave the currently active deployment in place. Fix the source or Node/configuration drift on a reviewed branch; do not bypass validation or enable production-bound previews to force a release.
3. For an approved code rollback, open Cloudflare Deployments, select the last healthy, schema-compatible version and review the rollback/deployment dialog. Confirm the exact destination/version with the owner before applying it. Verify active traffic, Access protection and owner smoke checks after it completes. Do not choose a version merely because its timestamp is newest.
4. Code rollback does not restore D1 data, reverse a migration or revert external provider actions. Keep migrations separate from routine builds and deployment. Review every SQL statement, current schema, additive/backward compatibility and a restricted recovery point before obtaining approval to apply a migration. Keep existing runtime variables/secrets and data bindings intact.
5. If schema compatibility or an external action's result is uncertain, stop, retain sanitized evidence and agree on a recovery plan. Do not blindly retry provider mutations, delete data or run down-migrations. Document the source/version and resulting checks in the issue without publishing private records, identifiers or logs.

This runbook is documented; no disruptive live rollback or database restore drill was performed. Such a drill is not needed to verify the existing deployment gate and requires its own reviewed operational authorization.


## Node security baseline

Build tooling and CI are pinned to Node 26.12.1, the October 21, 2026 security release (https://nodejs.org/en/blog/release/v26.12.1). The same advisory also patched Node 24 at 24.22.1; changing majors alone does not guarantee a security fix. Cloudflare supports a specific version via `NODE_VERSION` or `.nvmrc` (https://developers.cloudflare.com/workers/ci-cd/builds/build-image/). Set any dashboard override to exactly 26.12.1. CI rejects drift between the pin, workflow, lockfile, engine floor, and actual running Node version. The production Worker runs on Cloudflare's runtime; this Node pin controls build/test/deploy tooling. Review and test later security updates before moving the exact pin.
