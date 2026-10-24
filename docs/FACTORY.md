# Approval-gated software factory

Issue #16 tracks the full factory. This PR delivers its **read-only planning controls**, not an activated cloud-agent dispatcher.

Use the scoped issue template to describe scope, acceptance checks, regression tests, file paths and dependencies. A future trusted GitHub collector must fetch issue bodies, labels, owner comments and active runs directly from GitHub. It must verify the repository and completeness of that snapshot. An offline JSON file is only a planning/test input, never evidence of authorization to perform paid or external work.

`node scripts/factory-plan.mjs trusted-snapshot.json` reads that snapshot and prints a proposal. The module exposes `issueScopeDigest(issue)` so a trusted collector can show the owner the exact SHA-256 of repository, issue number, title and body. A matching owner comment `/factory approve DIGEST` is valid for seven days; edits invalidate it. The `agent-ready` label indicates readiness only. The planner never posts approvals or comments itself.

The snapshot contains `repository`, an `issues` array with number/title/body/state/labels/comments (comment author login, body and created_at), and an explicit `active` array with issue/files/state for running work. Missing/ambiguous scopes fail closed. Readiness parsing accepts CRLF while approval hashes retain the exact original body. Every required section must occur exactly once. Dot/root segments, repeated separators and noncanonical active-run paths are rejected; a trailing directory slash is canonicalized before protection/conflict checks. Closed or missing dependencies are distinguished; only closed dependencies satisfy the gate.

At most two independent candidates fit alongside active work. Overlapping file/directory scopes serialize. Authorization and owner-bound provider/action/reminder/push/private-record/quota modules, deployment, migrations and factory configuration are protected and require separate human handling. One branch/PR per issue prevents batching unrelated code changes into a single unreviewable change.

## Still required before execution

- Verify actual cloud-agent access, included usage and spending stop controls. Consumer Copilot is not GitHub Copilot cloud agent. Do not imply that API-backed GitHub Actions are included in a ChatGPT subscription.
- Select and verify a supported dispatch API/integration. Do not create credentials or start agent sessions merely because a plan lists candidates.
- Implement trusted snapshot collection, durable leases, global concurrency, duplicate webhook handling, bounded retries, cancellation, stale-run recovery and a kill switch. A read-only plan does not provide those runtime guarantees.
- Recheck current issue scope/approval, dependencies and budget at dispatch time.
- Give coding sandboxes source and synthetic tests only. Never provide production mutation credentials or private family data.
- Require CI and human review before merge. Keep migrations separate from normal deployment and preserve runtime approval for external actions.

The current output always sets `dispatchEnabled: false`. It makes no network call, writes no state, starts no agents and incurs no model usage. Tests cover scope/approval changes, owner attribution, readiness, dependencies, concurrency and conflicts. This is preparation for a small controlled trial, not a claim of an operational factory.
