# Shared task-start composition (disabled and unmounted)

`scripts/factory-start.mjs` composes the bounded GitHub task reader, shared D1
claim/uncertainty/identity primitives and the documented fixed-repository task-start
POST. It does not add a route, CLI, credential, binding or migration. The default
constructor performs no work. Explicitly enabling the library does not authorize a
provider run or establish a working production factory.

A trusted host must supply `authorizeDispatch(session, frozenRequest)`. Each call
must verify the current owner, exact frozen issue scope and full prompt/model,
approval expiry, dependencies and allowed files, source/synthetic-only inputs,
provider entitlement, current budget and a supported stop path. A digest supplied
by the request is not evidence of any of these gates. The callback is invoked before
reads, before claiming and immediately before the final stored-state check. No
production implementation of this trusted host or its evidence is provided.

The composition checks the provider inventory, atomically claims the single shared
slot and persists uncertainty before making one POST. Pause/cancellation observed
before transport blocks the request. It creates a PR from `main` with the exact
approved prompt and model; no caller-selected repository, existing branch, redirect
or automatic retry is allowed. A validated returned task ID is recorded immutably
even if pause/cancellation arrived during transport. Identity-storage failure
returns that known ID to the trusted caller and retains the lock.

The official start-response schema permits an omitted session count and specifies
an integer without a positive minimum. Zero/omitted counts do not discard a
validated identity. Unknown or malformed status metadata returns an uncertain
result with the known identity preserved. `started: true` means the POST was
acknowledged with that identity, not that a session is running or complete. Even
a terminal-looking response leaves storage uncertain for independent inspection.
See the start operation's 201 schema in the
[official OpenAPI description](https://github.com/github/rest-api-description/blob/main/descriptions/api.github.com/api.github.com.json).

There is no atomic transaction spanning D1 and an external HTTP request. A pause or
revocation after the final check cannot prevent a request already crossing that
boundary; cancellation remains a separate verified operational prerequisite.
Timeouts, errors, redirects, invalid responses and ambiguous storage retain the
claim. No GitHub idempotency header is assumed. A lost response can leave no known
task ID, and a late response is not guaranteed to survive Worker shutdown. Never
retry or release that lock based on an empty/stale inventory, timestamps or branch
names: authoritative correlation and separately reviewed recovery are required.

A `blocked` result can still retain a claimed/uncertain slot when authorization,
pause or cancellation changed after reservation. It is not permission to clear or
retry the slot. The base branch is fixed to `main`, not pinned to a commit; the
trusted host must bind/recheck its reviewed base state and account for base changes
until a future provider contract offers stronger revision guarantees.

The reader's paginated inventory is point-in-time evidence, not an exhaustive global
account inventory, a budget cap or a cross-provider lock. Local tests use independent
SQLite connections and synthetic HTTP responses; they do not verify D1 production,
real token permissions, provider stopping or live task creation. The reference
[GitHub task API](https://docs.github.com/en/rest/agent-tasks/agent-tasks) is public
preview. Starting requires a supported user token with Agent tasks write permission
and Copilot Business/Enterprise; installation tokens are not supported. Do not use
the feedback-publication token or a coding sandbox's credential.

Before activation: implement/review the trusted host and stop path, approve the exact
rollout, configure scoped credentials and shared storage separately, then perform
one bounded owner-approved synthetic live trial. The planner remains read-only.
