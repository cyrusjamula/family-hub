# Isolated AI transport spike

Issue #34. **Local synthetic protocol fixture only; no AI client or account integration has been verified.**

This dependency-free Node HTTP server tests discovery, tool schemas, a fictional task update and receipt readback. It binds exclusively to `127.0.0.1`, accepts no host/credential/data arguments, imports no Hub modules and performs no outbound requests. All state is in memory and disappears on shutdown. It cannot approve tasks, send messages, book travel, read Google files or access family records. Never provide it with real data or expose it through a public endpoint or tunnel.

## Deliberate protocol choice

This spike pins **MCP 2026-07-28**, using `server/discover` and per-request protocol metadata. It does not implement the earlier `initialize`/session lifecycle. Current primary specification describes both eras; the actual intended ChatGPT client's supported revision remains unverified. A legacy-only client cannot use this fixture. Confirm client support before extending the spike; do not infer support from this local test. Sources: [versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning), [discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover).

The selected JSON-response subset uses POST `/mcp`, UTF-8 JSON, mirrored protocol/method/tool-name headers, and required request `_meta`. Missing or mismatched headers fail before tool execution. Encoded tool-name headers are decoded before comparison. GET/DELETE return 405; no SSE, sessions, notifications or optional subscription capabilities are advertised. Host and present Origin must match this exact loopback authority. No CORS permissions are returned. Sources: [HTTP binding](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), [request metadata](https://modelcontextprotocol.io/specification/2026-07-28/basic/index).

Official OpenAI documentation describes tools without UI and local protocol testing separately from connecting a client. It does not establish this account's availability or pin the client's revision in the reviewed guidance. This handwritten fixture is a bounded experiment, not an official SDK or independently certified MCP implementation. Source: [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server).

## Run the local proof

Use the repository's reviewed `.nvmrc` Node version:

```sh
node --test test/ai-capability-spike.test.js
```

The tests start ephemeral loopback ports, exercise actual HTTP, and close every server. To inspect the fixture manually, `node scripts/ai-capability-spike.mjs` prints its ephemeral URL. Stop it with Ctrl+C. Only a local client that can supply the modern request envelope and HTTP headers can use it. No browser, Inspector, ChatGPT or Copilot run is claimed here.

| Tool | Fixed synthetic behavior |
| --- | --- |
| `synthetic_task_get` | Read `synthetic-task-1`, version and selected fictional park. |
| `synthetic_task_propose` | Choose only `park-a` or `park-b` using `expectedVersion` and a bounded `synthetic-…` request key. No arbitrary result text is accepted. |
| `synthetic_receipt_get` | Read a prior synthetic write receipt until shutdown. |

Tool definitions carry input schemas and read/write annotations. Successful results include text and structured content. Unknown tools return protocol errors; argument/version/idempotency conflicts return tool errors. Source: [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).

One synchronous in-memory compare/mutate/receipt step makes competing same-version writes produce one winner. An identical retry returns its original receipt; changed content under the same key conflicts. At 64 writes the fixture rejects additional mutations without discarding receipts. This is temporary single-process test state, **not durable cross-process exactly-once behavior**. All local callers share this fictional state; client metadata is self-reported and grants no identity or authorization.

## What the tests establish

- Modern discovery, deterministic schemas, write/readback and receipt lookup over loopback HTTP.
- Duplicate requests do not mutate twice; competing stale versions conflict.
- Unknown tools, invalid arguments and invented identity/approval fields cannot perform another operation.
- Header/body mismatch, unsupported revisions, wrong Host/Origin, invalid negotiation, malformed frames, invalid UTF-8 and oversized bodies fail without changing the task.
- Separate server instances have separate state; write capacity is bounded.

## Gates still open

Before a real client trial, separately review an authorized way for the actual client to reach an isolated synthetic endpoint, its protocol version, authentication and cost. This fixture supplies no authentication and must stay local. Do not expose it unchanged. Before any Hub adapter, review per-member verified identity, current permissions, durable state and exact-action approvals under #35/#36. Current Google resources stay Restricted, and the owner connection cannot become a shared credential. Consumer Copilot participation remains unproven. No live account, private record, provider request, public endpoint, tunnel, credential or deployment was used for this change; #34 remains open.
# Offline synthetic authorization experiment

`scripts/ai-synthetic-auth.mjs` is a separate local-only resource-authorization experiment. Tests generate ephemeral signing keys and fictional owner, parent and child tokens; they exercise signature, issuer, audience, expiry, scope and role checks against fixed synthetic operations and choices. Denied writes do not mutate the in-memory fixture. It is not an OAuth authorization server, MCP endpoint, token issuer, user login, protected production service or evidence of client/account compatibility. It is not connected to the HTTP fixture or Worker, and must not be exposed publicly or used with real credentials or family information. OAuth discovery, PKCE, per-member identity, actual consent, durable idempotency, source permissions and live end-to-end tests are still required in a separately reviewed integration.

## Authorized loopback protocol experiment

`scripts/ai-synthetic-authorized-mcp.mjs` composes the separate synthetic token verifier with a second, loopback-only MCP HTTP fixture. Tests sign fictional identity tokens with ephemeral keys and check tool calls over local HTTP for valid signature, issuer, audience, scopes and fictional role boundaries. Unauthenticated/invalid token requests and child requests to private rooms return a generic denial; denied writes do not alter state. Discovery advertises only fixed synthetic tools. HTTP requests remain bounded and origin/authority restricted; a maximum of 64 accepted or in-flight writes is enforced.

This is still a local test harness: it has no OAuth discovery, authorization-code/PKCE, client registration, verified real member identities, durable storage or idempotent write receipts. It is not connected to the Hub, a ChatGPT client, a tunnel, Cloudflare, or a production auth server. **Do not deploy or expose it.** Passing these tests cannot establish account access, connector compatibility or live permission isolation; those require a separately reviewed integration and real-client acceptance.

## Protected-resource boundary preparation

`src/integrations/mcp-resource.js` provides an unmounted, reusable OAuth resource boundary: protected-resource metadata and an authentication challenge, ES256 `at+jwt` signature/type/issuer/audience/time/scope checks, and a trusted per-request membership lookup. It returns only the lookup's member identity and role, never the role asserted in a token. The host must select the required scope from server-controlled routing; task and room authorization remain the downstream handler's responsibility. Tests use ephemeral keys and fictional identities.

This boundary has no route, authorization server, OAuth discovery/PKCE, membership implementation, token issuance, network listener or configured key. No provider has been selected or validated to issue compatible short-lived ES256 `at+jwt` tokens. It cannot itself authenticate a real account or provide an end-to-end MCP service. A later, separately reviewed integration must select a compatible issuer and public-key rotation strategy, implement current membership and per-operation checks, wire bounded MCP handling and durable idempotency, and verify actual ChatGPT/client behavior. Do not deploy or expose this module as a complete OAuth implementation.

