# People and sign-in aliases

One person has one stable ID (`cyrus`, `anhaita`, `iyanah`, or `aarish`) and one role. Approved additional addresses resolve to that same person only after the Access JWT is cryptographically verified. Names, request bodies, headers containing unverified email addresses, plus tags, and similar spellings cannot link accounts.

The existing canonical email in `people` is an immutable storage key, not necessarily the address used to sign in. Existing D1 owner columns and AES-GCM associated data continue using that key. This preserves existing Google credentials, encrypted private records, actions, reminders, and push devices without a destructive data migration. Do not change those canonical values when adding/removing an alias. Google OAuth still requires the owner's existing specified Google account; a Hub alias does not authorize a different Google provider account.

## Runtime configuration

Keep extra personal addresses out of public source, issue bodies, build variables, logs, and test fixtures. Store `MEMBER_ALIASES` as a Cloudflare **runtime secret** containing a JSON object from exact approved email address to existing person ID. Synthetic example:

```json
{"owner.alias@example.test":"cyrus","adult.alias@example.test":"anhaita"}
```

Omitting the secret leaves existing canonical sign-ins unchanged and grants no alias access. Invalid JSON, unknown person IDs, duplicate aliases after case normalization, canonical-address collisions, whitespace, or more than 32 aliases fail closed. A canonical address must not be repeated in the alias configuration, even for the same person. No automatic account linking or self-service role assignment exists. Removing an alias from this configuration denies it on the next authenticated request, even if its Access session still exists.

Email recipients are a separate allowlist: adding a sign-in alias does not add an outbound notification/email recipient or silently change a reviewed action payload.

## Rollout and verification

1. Review the exact proposed alias-to-person mapping privately with the owner. Obtain applicable authorization before granting new access. Never put that real mapping in a public PR.
2. Review and apply additive migration `0006_identity_audit.sql` before deploying this code. Review recovery/backup first. It creates only the audit table/index and can be reapplied; it does not rewrite old owners or ciphertext.
3. Merge the reviewed code and deploy through the validated pipeline. A missing audit table causes same-origin mutation attempts to fail before side effects, rather than silently losing provenance.
4. Set the runtime `MEMBER_ALIASES` secret, and update the existing Cloudflare Access application's explicit email allowlist for those exact aliases. Do not add broad domains, Everyone, public access, or a second application. Both Access and application checks must allow the address.
5. Verify each approved alias displays the same person/role and can access the same existing records/devices/tasks while retaining the same room restrictions. Verify an unapproved alias is rejected. Other members use their own sign-in codes.

## Provenance

`identity_audit` records the stable member ID, actual verified sign-in address, fixed API route, HTTP method, request ID, and timestamp for recognized same-origin mutation attempts and Google OAuth callbacks. These rows prove the authenticated attempt, not the operation's success. Success/uncertainty remains in the existing action records. No payload, chat text, question, record content, query string, token, or OAuth code is copied into the audit. Audit rows have no shared-room or member-facing API and stay in restricted D1. Historical attempts before this rollout cannot be reconstructed.

## Rollback

Remove/revoke an alias from both runtime mapping and Access before changing its ownership. Do not reassign an existing alias to another person without explicit review. Removing an alias does not delete that person's records. A Worker rollback leaves the additive audit table in place. Never rename storage keys or re-encrypt stored data as an incidental alias change.
