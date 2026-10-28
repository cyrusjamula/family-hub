# Official OAuth protocol candidate

`createFamilyOAuthProvider` is an unmounted, default-disabled composition using
the pinned `@cloudflare/workers-oauth-provider` 1.2.4 implementation. It provides
authorization-server discovery, optional Dynamic Client Registration, a
browser-bound explicit consent page, authorization-code/PKCE exchange, token
validation/revocation and a read-only task resource. It uses opaque provider
tokens, not the separate ES256 resource candidate in `mcp-granted-read.js`.

Enabling this constructor in a reviewed host requires:

- Canonical HTTPS issuer and resource URLs, with an explicit router and the
  provider's `OAUTH_KV` storage binding. No production binding is added here.
- An `authenticate(request)` callback that independently verifies the real
  signed-in session and returns an immutable member ID. Never derive it from a
  request field or an unverified identity header.
- Current `resolveMember(id)` and `resolveRegisteredClient(memberId, externalId)`
  callbacks. The latter must resolve an already approved, currently connected
  registration to its stable internal grant-client ID. This constructor does
  not create connections or approve clients. Raw OAuth/CIMD identifiers are not
  treated as internal grant authority. Remapping or disconnecting a registration
  invalidates a token's stored binding.
- The existing owner-approved task grant service with its current membership,
  internal client connection, audience, version, expiration and revocation checks.
  OAuth consent alone does not grant access to a task.

The consent page escapes all client metadata, displays the client ID, redirect
host, resource and read-only limits, and provides Allow/Deny actions. Provider
consent handles are browser-bound and single-use. An additional short-lived KV
record binds the page to its signed-in member and approved internal connection;
switching accounts or connections before submitting is rejected. Form posts
require the issuer's Origin and have a bounded body. Consent is not remembered
automatically. Access tokens have a ten-minute lifetime and the OAuth refresh
grant a fixed one-hour lifetime. The library checks the token's resource;
the resource handler explicitly enforces `tasks:read` and current identity.

Dynamic registration is disabled unless explicitly selected by the reviewed
host. Registration is not authorization: an unapproved client cannot reach the
consent page or read a task. Client ID Metadata Document fetching remains off;
no new compatibility flag or outbound metadata fetch is enabled here. The
official provider also supports a separate authorization Worker over a Service
Binding, but this candidate keeps both roles in one unmounted object.

The tests run the installed library's actual registration, discovery, consent,
PKCE, code exchange, encryption/storage, validation and revocation against an
in-memory KV adapter, then read owner-consented task data through the MCP Fetch
handler and actual task SQL schema in local SQLite. Only the unavailable Node
`cloudflare:workers` base class is shimmed; the OAuth logic is not mocked. All
identities, tasks, clients and keys are synthetic. No callback or provider is
contacted over the network during these tests.

Remaining live gates: trusted real session authentication, owner-managed client
registration/alias directory and task-consent UI, reviewed KV/bindings/routes and
deployment, real Workers/KV/D1 concurrency and failure verification, an approved
account-specific client trial, key/credential recovery and operational revocation.
No Worker route, runtime binding, credential, migration or production activation
is included. It does not implement proposal writes, prove ChatGPT/consumer
Copilot compatibility, or satisfy issue #34/#36's live acceptance checks.

Primary references:

- https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/
- https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/authorization-server.md
- https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/resource-servers.md
