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
- A trusted `consentClaims` guard. The supplied `createD1ConsentClaims` is disabled
  by default and uses the separate review-only schema in
  `scripts/mcp-consent-claim-schema.sql`. No production migration or binding is
  supplied. An enabled OAuth host must provide this guard; missing or disabled
  claims cannot authorize a consent POST.

The consent page escapes all client metadata, displays the client ID, redirect
host, resource and read-only limits, and provides Allow/Deny actions. Provider
consent handles are browser-bound. The pinned provider itself uses separate KV
reads and deletes and does not guarantee atomic consumption. This host therefore
adds an atomic consent claim before calling either provider consent method.
An additional short-lived KV
record binds the page to its signed-in member and approved internal connection;
switching accounts or connections before submitting is rejected. Form posts
require the issuer's Origin and have a bounded body. Consent is not remembered
automatically. Access tokens have a ten-minute lifetime and the OAuth refresh
grant a fixed one-hour lifetime. The library checks the token's resource;
the resource handler explicitly enforces `tasks:read` and current identity.

The host also issues a random, HttpOnly, Secure, SameSite=Lax cookie for each
consent page, retaining only its hash in the KV binding. Missing, duplicate,
malformed or wrong-browser cookies, changed member/client identity and expired
bindings are rejected before storage consumption. Distinct tabs have distinct
handles/cookies. The library's own browser binding remains in force.

After these checks, a single conditional D1 insert claims the handle digest for
the verified member, internal client and Allow/Deny decision. The consumed record
is persisted **before** the provider can return a denial or mint a code. Duplicate
or ambiguous writes never proceed to the provider. A provider/storage failure
after this point does not release the claim: start a fresh authorization flow,
not a retry of the old handle. This record means consumed, not successful login.
Only a handle digest and binding metadata are stored; no raw handle, cookie,
authorization code or token is copied into the claim table.

The store permits at most 1000 retained claims (or a smaller configured cap) and
fails closed at capacity. Each atomic D1 batch prunes at most 100 claims whose
host consent bindings have expired, then attempts the new insert. Unexpired
consumed/uncertain handles are never pruned. The host rejects expired bindings
before claiming; an expired request cannot be revived by cleanup. The guard must
receive the original fixed `expiresAt` from the GET binding; a host must never
extend that deadline on POST or reuse an old handle for a new flow. No release or
production cleanup endpoint is provided. Review capacity and retention before
activation. Local
SQLite connections and racing worker threads verify one winner; they do not
establish actual D1/KV consistency or availability. This guard covers only this
host's consent endpoint. It does **not** make the SDK's code exchange, refresh,
other KV operations or other authorization hosts globally atomic.

The consent page's `form-action` CSP permits only its own origin and the callback
origin obtained from the library-validated registered redirect URI. This lets
Chromium follow both Allow and Deny POST redirects to a cross-origin callback;
all other page restrictions remain in place.

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
identities, tasks, clients and keys are synthetic. No real provider or public
callback is contacted during these tests.

The browser regression uses an actual local Chromium process and an ephemeral
loopback HTTPS server/certificate to submit both consent decisions and observe
the cross-origin callbacks. It uses no family account, provider or public
endpoint. Set `CHROME_BIN` to a local Chromium/Chrome executable if it is not on
the standard path; GitHub's Ubuntu runner supplies Chrome. The browser checks
are required in CI, and explicitly skipped locally when no browser is installed.
Sequential SDK replay tests do not prove atomicity under concurrency or real KV
consistency. The separate claim tests use independent SQLite connections and
worker threads, while SDK integration tests cover simultaneous Allow/Deny,
wrong-browser/client changes, failures after consumption and fresh-flow recovery.
Real D1/KV behavior and approved client trials remain operational gates.

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
