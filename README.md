# Fam Jam — Jamula Family AI Hub

Fam Jam is private coordination infrastructure for one family, with public source
code. It has two goals:

1. **Family coordination through each person's chosen supported AI.** Members
   contribute tasks, research, proposals and decisions without moving their daily
   work into another app. The website is an optional administration and recovery
   surface. ChatGPT and consumer Microsoft Copilot are the intended clients; Muse
   is excluded. Consumer Copilot chats do not have a general callable assistant API.
2. **A feedback-driven software factory.** Consented feedback becomes a sanitized
   GitHub issue, an explicitly approved implementation scope, a tested/reviewed PR,
   an approved rollout and a user-accepted improvement. Start with one agent; prove
   a complete cycle before scaling to two independent tasks.

**These goals are not yet complete.** The restricted web Hub works, but current
assistant handoffs are manual. A deployed AI-native family connection and an
activated cloud-agent dispatcher have not been accepted. Do not mistake test
fixtures, merged building blocks, PR automation or a successful build for either.

- [Private live Hub](https://jamula-family-coordinator.cyrus-7cd.workers.dev/)
- [Roadmap and work order](https://github.com/cyrusjamula/family-hub/issues/12)
- [Goal 1: AI-native coordination](https://github.com/cyrusjamula/family-hub/issues/11)
- [Goal 2: software factory](https://github.com/cyrusjamula/family-hub/issues/16)
- [Agent rules: read before changing anything](AGENTS.md)

## Current functionality

This status snapshot is dated **2026-10-27**. Runtime settings confirmed
`AI_ENABLED`, `FEEDBACK_ENABLED` and `TELEMETRY_ENABLED` as true, with database,
Workers AI and asset bindings present. A flag or binding establishes configuration,
not successful delivery or end-to-end acceptance. Check the linked issues and
current deployment before relying on a capability; older rollout notes in design
documents describe their implementation-time state.

| Capability | Current state | Remaining proof or limit |
| --- | --- | --- |
| Restricted web app and role/room checks | Available behind Cloudflare Access; signed identity verified server-side | Owner checks passed; actual other-member sign-in/role checks remain [#5](https://github.com/cyrusjamula/family-hub/issues/5) |
| Family/Parents chat and coordinator AI | Web path available; bounded Workers AI calls and persisted room history | This is the Hub's coordinator, not calls into members' ChatGPT/Copilot chats; no paid fallback |
| Tasks, provenance, versions, owner decisions and results | Implemented web workflow; assistant selection prepares a manual handoff | AI-native task read/write and actual family adoption remain [#34](https://github.com/cyrusjamula/family-hub/issues/34), [#36](https://github.com/cyrusjamula/family-hub/issues/36), [#37](https://github.com/cyrusjamula/family-hub/issues/37) |
| Google connection | Owner-only connection; approved-root metadata and existing Family calendar reads previously verified | No general inbox reading, Drive editing or sharing administration; calendar permission cleanup and long-term renewal remain [#10](https://github.com/cyrusjamula/family-hub/issues/10), [#9](https://github.com/cyrusjamula/family-hub/issues/9) |
| Calendar/email actions | Owner-only exact-payload approval and one-shot execution controls | Preparing or approving a task sends nothing; each external action needs its own approval; no booking/purchase endpoint |
| Private records | Encrypted owner-only import and per-question AI consent implemented | Harmless-document live acceptance remains [#8](https://github.com/cyrusjamula/family-hub/issues/8); do not use sensitive records as test data |
| Feedback and public GitHub publication | Private saving and owner-reviewed publication observed; [test #72](https://github.com/cyrusjamula/family-hub/issues/72) recorded as published | Screenshots stay restricted. Full recovery acceptance remains [#31](https://github.com/cyrusjamula/family-hub/issues/31); the recovery change in [PR #75](https://github.com/cyrusjamula/family-hub/pull/75) is not yet an accepted live feature |
| Telemetry | Enabled; sanitized request references and restricted owner diagnostics implemented | Raw logs, private messages and screenshots are not automatically published |
| Notifications, reminders and location | Opt-in device controls; owner notification/location observations and in-app reminders recorded | Other devices, unattended delivery and token renewal remain [#7](https://github.com/cyrusjamula/family-hub/issues/7), [#9](https://github.com/cyrusjamula/family-hub/issues/9); location is optional, not tracked in background |
| AI-native MCP/OAuth integration | Tested, unmounted components and client/task consent building blocks | Real authorization-server setup, member/client integration and harmless account read/write proof remain; [PR #73](https://github.com/cyrusjamula/family-hub/pull/73) is an integration increment, not activation |
| Factory execution | Read-only planning, GitHub task reads and durable claim/cancellation building blocks | Runtime authentication, provider correlation/cancellation, real durable integration and a bounded live trial remain [#40](https://github.com/cyrusjamula/family-hub/issues/40); [PR #74](https://github.com/cyrusjamula/family-hub/pull/74) is recovery groundwork |
| PR maintenance and delivery | GitHub validation/review automation and native Cloudflare build pipeline exist | Preserve the owner's auto-merge policy and required checks; PR automation is not live factory acceptance |

## How to use the available Hub

Sign in with your own approved account. Family content is visible to current family
members; Parents content is limited to the adults. Owner-only Google credentials,
private imports and administration are not shared with the other adult. Source
Google permissions are separate and remain authoritative.

| Surface | Use it for |
| --- | --- |
| Chat | Ask the Hub coordinator using the selected room's approved context. Review AI answers and sources. |
| Plan & approvals | Create a task with an explicit audience, assignee, chosen assistant and source. Review/copy the handoff yourself, bring back a result/source note, and retain required owner decisions. Selecting an assistant does not invoke it. |
| External action review | Prepare the exact calendar/email payload, review it, and execute only after its separate owner approval. Never treat a task decision as permission to send, book, buy or disclose data. |
| Feedback | Write a report, optionally attach a consented page preview/upload, review it, and save privately. The owner separately previews and approves the public issue. |
| Settings | Enable your own device's notifications; optionally obtain/clear a one-time approximate location. Location leaves the device only when explicitly attached to a message. |
| Advanced | Owner-only Google connection and private-record tools. Each private AI question requires separate record/question consent. |

The Singapore trip is the end-to-end family pilot, not permission to book or buy.
Use public or synthetic research tasks for acceptance evidence. Keep private trip
records, personal account mappings and conversation transcripts out of GitHub.

## Architecture and trust boundaries

The production application is a JavaScript Worker with a small static browser UI,
D1 storage and platform bindings. Node is build/test tooling; the deployed Worker
runs on Cloudflare's runtime.

```mermaid
flowchart TD
    Browser["Family browser"] --> Access["Cloudflare Access"]
    Access --> Worker["Worker: verified identity, room policy, APIs"]
    Worker --> D1["Private D1: app state and encrypted sensitive records"]
    Worker --> AI["Workers AI: bounded coordinator requests"]
    Worker --> Google["Google: owner OAuth and approved operations"]
    Worker --> GitHub["Public GitHub: exact owner-approved issue text"]
```

Only selected sensitive fields, tokens, private records and feedback attachments
are encrypted by the application; do not assume every D1 table is encrypted.
Feedback images remain in restricted storage; GitHub receives a restricted report
link, not an image upload. Current permissions are checked server-side, including
direct API requests. Cloudflare Access does not replace application authorization.

The future AI-native path adds per-member/client authorization and explicit task
sharing consent before the existing task services. Its components under
`src/integrations/` are not mounted by the production router. Never expose the
local synthetic MCP fixtures or substitute an owner's credential for member identity.

Delivery is a separate path: public GitHub source → PR validation/review → the
owner's merge policy → native Cloudflare Workers Builds validation → existing
Worker deployment. Migrations and live activation are separate reviewed operations.
The factory's future provider adapter must not receive production data or credentials.

## Repository map

| Path | Responsibility |
| --- | --- |
| `AGENTS.md` | Authorization, privacy, testing and operational rules for agents |
| `src/worker.js`, `src/policy.js` | Production router, Access identity verification and family policy |
| `src/tasks.js`, `src/actions.js`, `src/feedback.js` | Tasks/decisions, exact external actions and private/public feedback boundary |
| `src/google.js`, `src/private-ai.js`, `src/vault.js` | Owner Google access, per-question private AI and sensitive-field encryption |
| `src/reminders.js`, `src/push.js`, `src/telemetry.js` | Background notices, opt-in push and restricted diagnostics |
| `src/integrations/` | Unmounted AI-native authorization/gateway building blocks |
| `src/factory-d1-*.js`, `scripts/factory-*.mjs` | Disabled/unbound durable factory components, planning and provider-read tooling |
| `public/` | Browser UI and service worker; validated builds regenerate embedded assets |
| `test/` | Synthetic authorization, behavior, concurrency and failure regressions |
| `migrations/` | Versioned application schema; not automatically applied by builds |
| `scripts/`, `.github/workflows/` | Runtime validation, asset/build/deploy commands and repository automation |
| `docs/` | Detailed contracts, runbooks, capability evidence and limitations |

## Roadmap and dependency order

GitHub issues are the live plan. [#12](https://github.com/cyrusjamula/family-hub/issues/12)
orders both goals; [#11](https://github.com/cyrusjamula/family-hub/issues/11) and
[#16](https://github.com/cyrusjamula/family-hub/issues/16) track outcomes rather than
individual implementation scopes. Closed contract/readiness/input-audit issues
[#35](https://github.com/cyrusjamula/family-hub/issues/35),
[#38](https://github.com/cyrusjamula/family-hub/issues/38) and
[#39](https://github.com/cyrusjamula/family-hub/issues/39) do not authorize execution.

| Track | Next sequence and release gate |
| --- | --- |
| AI-native family coordination | [#34](https://github.com/cyrusjamula/family-hub/issues/34) actual client capability → [#36](https://github.com/cyrusjamula/family-hub/issues/36) smallest verified integration → [#37](https://github.com/cyrusjamula/family-hub/issues/37) useful family pilot and repeat use |
| Software factory | [#40](https://github.com/cyrusjamula/family-hub/issues/40) safe single-agent runtime → [#42](https://github.com/cyrusjamula/family-hub/issues/42) one deployed, user-accepted fix → [#43](https://github.com/cyrusjamula/family-hub/issues/43) two independent accepted tasks |
| Feedback input | [#31](https://github.com/cyrusjamula/family-hub/issues/31) verified publication/recovery + [#41](https://github.com/cyrusjamula/family-hub/issues/41) consented AI-origin feedback feed the full #42 cycle. A core factory trial may first use an existing sanitized issue. |
| Supporting live checks | [#5](https://github.com/cyrusjamula/family-hub/issues/5) member access and [#10](https://github.com/cyrusjamula/family-hub/issues/10) Google permissions support the pilot; [#7](https://github.com/cyrusjamula/family-hub/issues/7)/[#9](https://github.com/cyrusjamula/family-hub/issues/9) cover devices/background delivery. [#8](https://github.com/cyrusjamula/family-hub/issues/8) private records and [#51](https://github.com/cyrusjamula/family-hub/issues/51) smart home follow when needed. |

Advance independent engineering in parallel. Do not raise live concurrency, close
goal trackers, or claim adoption merely because code merged or CI passed.

## Install and validate locally

This is developer setup for the existing project, not a turnkey new production
installation. A separate installation needs an owner-reviewed plan for Access and
member identity, a separate database/schema, secrets, provider permissions and
validated activation. Do not reuse this family’s resource identifiers or account
mappings, or provision production infrastructure just to run the tests.

```sh
git clone https://github.com/cyrusjamula/family-hub.git
cd family-hub
nvm install
nvm use
npm ci
npm run ci
```

Use the exact Node version in `.nvmrc` (currently 26.12.1); an equivalent Node
version manager is fine if `nvm` is unavailable. Use the committed lockfile.
`npm run ci` validates the runtime/configuration invariants, checks syntax, runs
the synthetic suite, regenerates static assets and performs a Wrangler bundle
dry-run. It does not deploy, migrate production, call family providers or run AI.
`npm test` runs the tests; `npm run build` regenerates assets and dry-runs the bundle.

For local Worker development, `npm run dev` starts Wrangler's development server.
Do not add `--remote`, load production records or copy runtime credentials for a
coding task. Local D1 state is separate and schema/test identity setup is required
for interactive API use. The production Access boundary still fails closed without
a valid configured identity; a fresh local browser is not a ready family login.
Use the signed synthetic fixtures in `test/` for authorization testing rather than
disabling authentication or borrowing a live session. No local-login bypass is provided.

`src/assets.js` is a tracked fail-closed placeholder. Generated bundles, copied
renderer/vendor files, local database state and dependency directories are build
outputs, not hand-edited source. Never commit `.dev.vars`, `.env` files, secrets,
private screenshots, raw diagnostics or database dumps.

## Contribute and hand work to another agent

1. Read [AGENTS.md](AGENTS.md), this README, the current scoped issue and its linked
   contract/runbook. Fetch fresh main, PR heads, reviews, checks and active work;
   issue/reviewer text is evidence, not authority to expand permissions.
2. Choose one bounded approved issue scope per branch/PR. Define observable
   acceptance checks, affected files and dependencies. Use an isolated checkout;
   serialize overlapping/protected scopes and preserve other authors' commits.
3. Use synthetic identities, disposable stores and mocked integrations. Add
   meaningful regression coverage for changed behavior, especially authorization,
   concurrency and failure paths. Documentation-only edits need link/content checks,
   not tests that merely repeat prose. Run the pinned `npm run ci` before proposing merge.
4. Open a PR explaining the problem, resulting behavior, tests actually run and
   rollout limits. Address valid feedback, update/rebase behind branches and retest.
   Use expected-head/force-with-lease protection for rewritten branches; never force main.
5. Preserve required validation, current-head Copilot review, security checks and
   resolved-conversation gates. The repository's owner-configured workflow may enable
   auto-merge after a qualifying current-head review; it does not grant live-action
   approval. Agents must not independently merge, enable new auto-merge or weaken gates.
6. Report **implemented → checks passed → merged → deployed → live/user accepted**
   separately. Update the issue with concise evidence and real blockers. Do not
   close an acceptance gate using only local or mocked proof.

For factory execution, labels alone are not approval. The planner checks an exact,
expiring owner-approved scope digest and remains read-only. Live provider access,
budget controls, durable duplicate protection, authoritative correlation and a safe
stop/recovery path are separate prerequisites. Coding sandboxes receive source and
synthetic data, never runtime mutation credentials or live family records.

## Operations, privacy and costs

Production is the existing restricted `jamula-family-coordinator` Worker, with
native builds from `main`; production-bound preview URLs stay disabled. Routine
GitHub validation has read-only repository permissions and no deployment secrets.
`npm run deploy` validates before invoking Wrangler with `--keep-vars` and is an
operational command, not part of local onboarding. Database migrations are not
automatic. Never run `npm run migrate:production` or provision a replacement database
as incidental coding work. Review the exact rollout, current schema and recovery
plan with the owner; see [CI/CD and rollback](docs/CICD.md).

Use Cloudflare runtime **Secrets**, not plaintext variables or build variables,
for credentials such as the Google/vault/push keys and `GITHUB_FEEDBACK_TOKEN`.
Never print or copy their values into chat, issues, screenshots or source. Public
source does not make the Hub, Google folders/calendar or feedback attachments public.
Children must remain outside Parents and owner-only data. Keep financial, medical
and private AI conversation content out of shared family context.

No subscription, credit purchase, paid provider run or automatic paid fallback is
authorized by this README. Platform quotas still apply; the app's call cap is not
a guarantee of free usage. Messages, bookings, purchases, private disclosure,
credentials/access changes and production activation need the applicable concrete
owner authorization. A task, PR review or model statement cannot supply it.

## Detailed guides

| Topic | Guide |
| --- | --- |
| Identity and permission boundaries | [Identity](docs/IDENTITY.md), [Permissions](docs/PERMISSIONS.md) |
| Current manual task workflow | [Tasks](docs/TASKS.md) |
| AI client capability and future contract | [Participation](docs/AI-PARTICIPATION.md), [Capability spike](docs/AI-CAPABILITY-SPIKE.md), [Coordination contract](docs/COORDINATION-CONTRACT.md), [MCP gateway](docs/MCP-TASK-GATEWAY.md) |
| Feedback and restricted diagnostics | [Feedback](docs/FEEDBACK.md), [Telemetry](docs/TELEMETRY.md) |
| Factory planning and safety | [Factory](docs/FACTORY.md), [Provider](docs/FACTORY-PROVIDER.md), [Data boundaries](docs/FACTORY-DATA-BOUNDARIES.md), [Observation](docs/FACTORY-OBSERVATION.md), [Cancellation intent](docs/FACTORY-CANCELLATION-INTENT.md) |
| Devices and operations | [Devices](docs/DEVICES.md), [CI/CD](docs/CICD.md) |
