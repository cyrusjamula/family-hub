# Fam Jam — Jamula Family Hub

Private family coordinator hosted on Cloudflare Workers. Live hub: https://bit.ly/fam-jam-hub

## Source and delivery

Repository: https://github.com/cyrusjamula/family-hub (public source, as requested). The deployed hub remains restricted. Cloudflare Git integration is connected to the existing `jamula-family-coordinator` Worker. Initial automated build/deployment is being configured; do not claim it passed until its build log and live app are checked. See [CI/CD configuration](docs/CICD.md).

```sh
npm ci
npm run ci
```

Node 26.12.1 (security release). Direct dependencies pinned and lockfile committed. CI checks syntax, critical deployment invariants,the full security/behavior regression suite, regenerates embedded static assets and runs a Wrangler bundle dry-run. `npm run deploy` deploys using `--keep-vars`. Production branch is `main`; preview builds/URLs stay disabled. Database migrations are reviewed separately with `npm run migrate:production`; migrations0001–0005 already exist in production. Never deploy to a newly provisioned database accidentally.

## Application

- Chat for family planning, with room-scoped approved Singapore reference and durable conversation history.
- Plan & approvals for owner-reviewed calendar/email payloads and one-shot reminders.
- Settings for per-device, opt-in location and generic push notifications.
- Advanced for Cyrus’s Google connection, explicit encrypted private document import and per-question private AI consent.

Cloudflare Access protects the live app. Server verifies signed JWT issuer, audience, signature and expiry before assets/APIs. Cyrus is owner, Anhaita is parent, Iyanah and Aarish have Family-only access; revoked old Iyanah address is excluded. Family and Parents rooms isolate history, AI context and notices. Personal Google credentials/private imports are Cyrus-only, including from Anhaita. Existing Google Drive ACLs and Family calendar are separate and must stay restricted. Actual sign-ins by the other three family members remain to be tested.

## AI and Google

Workers AI uses the fixed model in `src/policy.js`,700output tokens, and80family-wide calls/day. Provider Free limits remain ultimate cap;80calls are not guaranteed to fit. No paid fallback or autonomous tool loops. Current sanitized Singapore pilot retest preserved both Seoul windows, airport-return targets and unresolved accommodation dates. AI can still make mistakes. Consumer Copilot has no general callable assistant API; Muse excluded.

Google OAuth scopes: openid/email, drive.readonly, calendar.events.readonly, calendar.events and gmail.send. Google grants account-wide provider scopes; server restricts Drive reads by ancestry to the two existing Hub roots, calendar actions to the existing Family calendar, and email recipients to the exact four family accounts. No inbox reads, Drive edits/ACL changes or existing invitation draft changes. OAuth is Testing with only Cyrus as test user; consent may expire after7days. Refresh-token expiry/revocation behavior is tested synthetically; longer-term live renewal still needs observation. Drive folder metadata access and existing Family calendar read verified.

## Action approval

Only Cyrus proposes/reviews/executes external actions. Canonical payload, SHA256 digest and24hour expiry bind exact approval. Preparing a proposal never executes it. An atomic claim prevents double execution. Calendar forces existing Family ID, explicit offsets, no attendees and `sendUpdates=none`. Email is plain text to selected allowlisted recipients. Uncertain provider responses never retry automatically. No booking/purchase endpoint. Current test event/email proposals are pending or may expire; neither was executed by setup.

## Private records, location and notifications

Tokens and imported document content are AES-GCM encrypted with owner/source AAD. Imports require explicit selection/consent; only Google Docs/plain text in approved roots. Source access/ancestry/modified time rechecked before reads/AI. Private AI requires separate selected-record consent each question and returns without saving any shared-room message. No private document live AI test completed yet.

Location uses a one-time low-accuracy device fix, rounded coordinates held only in page memory. Including them in a chat requires an explicit per-message checkbox. No background tracking or automatic location upload. Actual fix could not be obtained on setup device.

Reminders deliver once in their confirmed room. A15minute cron is saved and on-open catch-up passed live. Push uses an opt-in device subscription, encrypted endpoint, signed empty wake-up and generic lock-screen text. Membership/room checked before each send, stable delivery claims, no automatic retries after uncertain sends, max8sends/tick. Service worker caches no pages. Browser notification consent/registration/end-to-end delivery remain to be verified on each device; iOS requires Home Screen installation. No automatic email digest configured.

## Secrets and cost

Runtime secrets remain only in Cloudflare: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_ENABLED, GOOGLE_VAULT_KEY, PUSH_VAPID_JWK. OAuth tokens/imported records live only in encrypted D1. No actual credentials, passport data, payment records, database dumps or `.wrangler` state belong in this repository. Do not copy runtime secrets into build variables or CI logs. Deployment authentication is native Cloudflare build configuration, separate from Google credentials.

Workers Free only; no subscription upgrades or paid add-ons authorized. Native Cloudflare Builds avoids GitHub Actions runner usage for this pipeline. Platform quotas apply. Keep previous healthy deployment available for rollback; schema rollback is separate. See docs/CICD.md for operations.

