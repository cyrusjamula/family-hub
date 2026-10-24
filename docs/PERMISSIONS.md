# Verify family access

The Hub trusts a verified Cloudflare Access token and maps it to a stable family member. Provider role claims and email headers cannot grant a role. Approved alternate sign-ins map to the existing member; they do not create another owner or another Google connection. Keep the exact email mapping in encrypted production configuration, outside this public repository.

| Person | Hub role | Family room | Parents room | Owner Google, action and reminder controls |
| --- | --- | --- | --- | --- |
| Cyrus | owner | Allowed | Allowed | Allowed |
| Anhaita | parent | Allowed | Allowed | Denied |
| Iyanah | child | Allowed | Denied | Denied |
| Aarish | child | Allowed | Denied | Denied |

## Live acceptance

After this change is reviewed, merged and deployed, each person signs in with their own authorized account on their own device. Cyrus should also test the approved alternate account in a separate private browser window. Do not share login codes or impersonate another person. Avoid logging out other Cloudflare Access applications to perform this test.

1. Open Settings, then **Check my access** (or `/access-check.html`). It does nothing until **Run access checks** is selected.
2. Confirm the displayed person and role are yours. Run the check and expect five passing checks. It reads status codes and immediately discards private response bodies; it sends no messages, calls no AI, changes no permissions and saves no report.
3. On any mismatch, stop and tell Cyrus only the check name and status. Never paste private response bodies, login codes, emails or screenshots into public issues.
4. In the main Hub, verify Family navigation works. Anhaita can also open Parents. Children cannot open Parents or Advanced. Only Cyrus has owner controls.
5. Cyrus verifies Google remains connected in Advanced under both approved sign-ins. Connection state comes from `/api/google/status`; the legacy `googleConnected` field in `/api/me` is not authoritative.
6. Refresh an expired session: the page must remove prior messages and drafts and ask for a reload to verify the account. Network or ordinary service errors preserve the current draft. If an external action was submitted before expiry, check its outcome before retrying.

Record only person, role, check results and time in the private rollout notes. Automated synthetic tests do not substitute for these device and identity checks. Keep tracking issues open until live acceptance is verified.

## Regression coverage

`test/permission-boundaries.test.js` exercises signed tokens for all four roles, forged role claims, forbidden owner routes and mutations, child Parents-room access, positive room separation, removed aliases and invalid credentials. Provider calls are blocked by fixtures. Audit assertions allow only the expected synthetic attempt provenance.

`test/client.test.js` covers room drafts, stale responses, hidden owner controls and removal of private UI on authentication denial or login redirects. `test/access-check.test.js` verifies explicit initiation, all roles, response cancellation, stop-on-mismatch, invalid identities, auth/transport failures and overlapping clicks. All fixtures are synthetic.

The checker verifies Hub routes. It does not prove Drive folder inheritance, Google Calendar sharing, provider entitlements or external integrations; those need their own checks.
