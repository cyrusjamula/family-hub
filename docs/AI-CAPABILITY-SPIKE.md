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
