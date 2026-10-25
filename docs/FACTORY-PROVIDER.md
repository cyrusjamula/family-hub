# Factory provider decision

Issue #38 · documentation checked 2026-10-25 · **live dispatch remains disabled**.

The cheapest next step is to finish the mock controller and privately prove an already-authorized included-usage route. Do not purchase a plan, use a workplace entitlement for a personal project without permission, or treat a visible agent button as spending authorization. This document records documentation evidence, not a completed account trial.

## Candidate routes

| Route | Supported interface and evidence | Cost and authorization gate | Decision |
| --- | --- | --- | --- |
| GitHub Copilot cloud agent tasks API | Preview REST create/list/get; repository-scoped task ID and PR artifacts. API reference requires Business/Enterprise although the general how-to says all paid plans. Verify the selected endpoint/account rather than inferring eligibility. [Task reference](https://docs.github.com/en/rest/agent-tasks/agent-tasks), [how-to](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api). | Authorized billing source, repository entitlement, current included capacity, paid usage disabled at the actual billing entity, and verified stopping procedure. | First API candidate if all private gates pass; not selected for activation. |
| Copilot issue assignment | Supported REST/GraphQL route; assignment starts work. Its credential requirements differ from the task API. [How-to](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api). | Same billing gates; do not assign a bot as an eligibility probe. | Alternative only after comparing exact permissions and recovery. |
| Codex Cloud using the existing ChatGPT account | Published cloud environments support remote tasks; documented experimental CLI offers `codex cloud exec` and JSON task listing. [Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments), [CLI reference](https://learn.chatgpt.com/docs/cli/reference). | Verify the owner's permitted account, remaining included usage, credit purchase/overage controls, environment permissions, and stopping/reconciliation before activation. | Candidate for an owner-operated included-usage pilot; unattended factory integration remains unproven. |
| Codex GitHub Action / OpenAI Agents API | The Action runs `codex exec` in CI with an API key. Agents API provides a managed Codex harness with model/tool/container API billing. [Action](https://learn.chatgpt.com/docs/github-action), [Agents API](https://developers.openai.com/api/docs/guides/agents-api/overview). | Separate API usage and hosting charges require an approved budget and enforced stops. Existing ChatGPT access is not proof of included API usage. | Excluded from the zero-new-charge pilot. |

Consumer Microsoft Copilot used by family members is a different product from GitHub Copilot cloud agent. This selection does not change the family AI participation decision in #34.

## Authentication and provider operations

For the **tasks API**, the reference requires a user-to-server fine-grained PAT or GitHub App user token: `Agent tasks` repository permission read/write for creation, read for lookup. Installation tokens are not supported. Limit any approved credential to this repository and expiry; keep it outside the coding sandbox. Do not reuse the feedback-publication token or the connected assistant's credential. The issue-assignment how-to instead lists metadata read plus actions/contents/issues/pull-request read/write; do not grant that larger permission set merely to use the tasks route. [Task reference](https://docs.github.com/en/rest/agent-tasks/agent-tasks), [assignment permissions](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api).

Task operations documented for the selected route:

| Operation | Evidence / required handling |
| --- | --- |
| Start | `POST /agents/repos/{owner}/{repo}/tasks`; store returned ID and URLs durably. |
| Reconcile | Repository task list and `GET /agents/repos/{owner}/{repo}/tasks/{task_id}` return status and artifacts. The controller must independently verify issue/scope/PR linkage. |
| Stop | GitHub documents **Stop session** in its session viewer, which ends the Actions run and preserves pushed commits. The task REST reference inspected has no cancellation endpoint. Do not invent one or assume deleting an assignee cancels a run. |
| Unknown start result | Persist `uncertain`, pause that scope, inspect provider tasks before any retry. A prompt marker is correlation evidence, not provider-enforced idempotency. Never automatically repeat an ambiguous POST. |

Sources: [REST task reference](https://docs.github.com/en/rest/agent-tasks/agent-tasks), [session management](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents). Automated cancellation remains a **blocking capability gap for unattended activation** until a supported route is established and harmlessly verified. A strictly owner-operated synthetic eligibility trial can instead use a verified manual Stop procedure, with the owner present throughout and separate exact trial/budget approval. Neither type of trial is authorized by this document. A local timeout or revoked credential does not prove remote work stopped.

Codex Cloud's documented CLI submission uses the main CLI credentials and a published environment ID; task listing exposes IDs/status. This review does not establish a cancellation command or durable dispatch idempotency. Do not copy a personal `auth.json` into public-repository CI: official non-interactive guidance explicitly excludes public/open-source repositories from its advanced saved-ChatGPT-auth CI workflow. Use an approved product integration or separately reviewed trusted control plane instead. [CLI reference](https://learn.chatgpt.com/docs/cli/reference), [non-interactive authentication](https://learn.chatgpt.com/docs/non-interactive-mode).

## Hard stop before the first live run

For Copilot organization/enterprise billing, GitHub documents paid AI credit usage as enabled by default. An authorized administrator must disable that policy to prevent spending beyond included credits. Exhausted included capacity then blocks use; an alert alone is insufficient. Budgets and billing reports apply to the actual billing entity, not necessarily the personal account. [Billing controls](https://docs.github.com/en/copilot/concepts/billing-and-usage/organizations-and-enterprises/billing), [billing API](https://docs.github.com/en/rest/billing/usage).

Record a private verification receipt with timestamp, verifier, permitted project/purpose, selected provider/endpoint, billing entity class, included quota, hard-stop setting, expiry, and credential reference **without the secret**. Public issues receive only pass/blocked and sanitized reason classes. Unknown, stale, missing, revoked or exhausted evidence must prevent dispatch. An API usage report is observational; it cannot substitute for a provider-enforced spending stop. Recheck before every run and after account/policy changes. Never fall back to another model, account, paid key, runner or provider when a gate fails.

## Minimum provider contract for #40

Implement provider-independent policy/state tests before any network adapter. A candidate adapter must expose explicit capabilities rather than claiming generic support:

| Contract | Required result |
| --- | --- |
| `preflight` | Current entitlement, owner/billing authorization and verified no-overage receipt; missing evidence fails closed. |
| `start` | Frozen approved issue digest, source commit, allowed files, one attempt and correlation ID; durable external ID or `uncertain`. |
| `inspect` | Normalized status, provider evidence timestamp and verified PR/head references. Unknown status is nonterminal and blocks retry. |
| `stop` | Supported cancellation acknowledgment followed by terminal-status verification; otherwise `manual_stop_required` and global pause. |

The durable store, not model instructions, owns claims, approval expiry, pauses, attempt limits and transitions. No automatic merge, deployment, credential activation or approval expansion. Protected files and private data remain outside a normal agent scope. Reconciliation reads may retry within bounded limits; dispatch does not retry after an ambiguous outcome.

## Smallest live trial, prepared but not started

Proposed source-only manifest:

```json
{"files":["scripts/runtime.mjs","test/runtime.test.js"]}
```

The proposed task is **test-only coverage for malformed and empty runtime pins**. Read the helper and extend `test/runtime.test.js` with fabricated inputs that assert rejection; do not claim a production bug has been found and do not modify the helper unless a separately reviewed failure warrants scope expansion. The two files passed the source-input preflight and their three existing focused tests passed locally. Those checks establish a small candidate input, not a safe provider environment or an authorized run.

Before either trial, freeze the reviewed source commit and exact file digests, export **only those two approved files**, and verify the actual sandbox contains no other repository content, history, credentials or connected private sources. Full-repository checkout remains disallowed pending #39. A provider integration that necessarily clones the repository cannot be used for this reduced-input trial until that gap is resolved; a manifest beside a full checkout is not isolation. Dependency-free validation is `node --test test/runtime.test.js` with the reviewed Node pin.

For a strictly owner-operated eligibility trial, the owner separately approves the exact task digest, provider, permitted included-usage billing source, no-overage evidence, single attempt, source export and verified manual Stop procedure. The owner remains present to monitor progress and stop work; preserve the run link and confirm terminal status. This can establish eligibility without pretending an unattended dispatcher is ready. No such approval or run has occurred.

For an unattended trial, #39 and the tested #40 controller must pass **and** supported automated cancellation/reconciliation must be verified before separate activation approval. Record the durable run/PR links, evaluate the tests, and retain human review. Neither route permits production secrets, private feedback, Google records, screenshots, deployment permissions or automatic merge.

Mock acceptance for #40 must assert **zero start calls** for disabled dispatch, absent/revoked billing authorization, stale entitlement/stop receipts, quota exhaustion, missing credential reference, failed dependency, changed scope, duplicate/concurrent claim and global pause. Simulate lost POST responses and cancellation failure; both must block retries until reconciled. These are required future tests, not tests claimed as run by this documentation change.

## Remaining private evidence

- [ ] Owner-authorized billing source and permitted family-project use.
- [ ] Actual selected endpoint/account eligibility and least-privilege credential review.
- [ ] Provider-enforced no-overage setting and remaining included capacity.
- [ ] Published source-only sandbox with no production mutation credentials (#39).
- [ ] Supported stop mechanism and verified status reconciliation.
- [ ] #40 mocked gates and durable claims pass; exact first-trial approval recorded.

No provider request, credential creation, billing setting change or live agent task was performed for this review. Issue #38 stays open until the live evidence is complete.
