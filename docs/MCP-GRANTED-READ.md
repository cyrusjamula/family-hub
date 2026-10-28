# Client-bound, consented task reads

`createGrantedMcpReadGateway` composes the existing OAuth resource verifier,
read-only MCP transport and owner-approved task grants. It is unmounted and
disabled by default. The production Worker does not import or invoke it.

A reviewed host may enable this composition only with a pinned issuer and
verification key, current membership and client-connection resolvers, and the
configured grant service. The issuer must attest the `client_id` claim in its
ES256 `at+jwt` access token. Configuring `resolveClient` on the resource boundary
requires this signed claim and a current member/client connection. Client IDs
from MCP arguments or headers are never accepted as identity. The trusted
member/client principal is passed separately to the grant reader.

The grant reader checks the current assignee, room eligibility, exact task
version, consent expiration, revocation, membership and client connection again
before selecting task fields. A connection removed between authorization and
the read is denied. Neither a valid token alone nor another connected client
may use a grant for a different client. Only `task_read` is advertised; proposal
writes are rejected. Metadata advertises only the read scope.

Synthetic integration tests use ephemeral signing keys and the existing tasks
migration in local SQLite with a D1-shaped adapter. They exercise the Fetch/MCP
request path through cryptographic identity, current connection and grants to
the selected database fields, including concurrent reads and invalidations.
They do not prove Cloudflare D1 behavior or a real client/account connection.

This code creates no OAuth issuer, PKCE flow, client registration, consent UI,
membership directory, route, credential, grant, production migration or provider
call. Before activation, the host still needs a reviewed issuer/client identity
contract, real owner confirmation and grant storage, key lifecycle, source-access
validation where source content is involved, D1 integration verification and an
explicitly approved rollout. A separate authenticated synthetic client trial
must verify the actual ChatGPT read path; writes, consumer Copilot participation
and issue #36's end-to-end acceptance remain open.
