# AI-native family coordination pilot

This runbook prepares the human acceptance session for [issue #37](https://github.com/cyrusjamula/family-hub/issues/37). It is a checklist, not evidence that the pilot has happened. The shared Hub is infrastructure; participants should do their normal work through their own supported AI.

## Start gate

Do not start the family pilot until all of these are true:

- [ ] The owner has selected an AI entry point that has demonstrated the required read and write operations from inside that client. Use the capability evidence and limitations in [AI participation](AI-PARTICIPATION.md); do not infer support from protocol tests, web search, another person's account, or assistant prose.
- [ ] The selected route has a reviewed identity and consent design, with server-side role, room, source-access, version and audience checks. No shared owner credential is used.
- [ ] The applicable integration is deployed and verified against its reviewed scope. Keep any unselected integration disabled.
- [ ] Owner sign-in and permission-boundary checks in [issue #5](https://github.com/cyrusjamula/family-hub/issues/5) and the Google permission review in [issue #10](https://github.com/cyrusjamula/family-hub/issues/10) are complete for the rooms and sources this pilot will use.
- [ ] Each participant is available to sign in to their own account on their own device. Do not impersonate anyone or collect sign-in codes.
- [ ] Everyone knows the session uses harmless travel-planning research only. No purchases, bookings, calendar writes, automatic messages, or sharing of private records are part of this test.

If a gate is missing, record the blocker privately and stop. Keep the issue open; do not substitute a website workflow, copy/paste relay, or unverified client.

## Session checklist

Use a generic family travel-planning scenario as the session context. Keep actual dates, destination, flight details, hotel, home address, named assignments, account identifiers, screenshots and private conversation content in the participants' private AI sessions. Do not paste them into this public repository. For public-source research, each participant can investigate a harmless activity or a public layover option without disclosing an actual itinerary.

1. **Verify the client and identity.** Each participant independently opens the selected AI and authenticates using their own account. Check that the Hub recognizes the expected role and only offers that role's allowed rooms. Record the result privately; publish only a sanitized participant label and pass/block status.
2. **Retrieve one assigned task.** Ask the AI to retrieve the shared pilot task and its current version from the connected coordination service. Confirm the returned task ID, audience, version and sources match what the owner prepared. Do not treat a generated answer as proof of retrieval.
3. **Make a sourced proposal.** Ask the AI to research one public, harmless activity or layover option. Submit a short proposal through the supported write operation, including public sources and the task version. Do not include private travel details in a public issue or task visible to children.
4. **Verify the saved receipt.** Confirm the tool returns a durable receipt/version. Read the saved proposal back from the service. Retry the identical payload with the original idempotency key and confirm it returns the original receipt without creating a duplicate. Then use a fresh idempotency key with the pre-write expected version; require a version-conflict response and read the proposal back to confirm its saved version and contents are unchanged.
5. **Review and decide as the owner.** The owner checks the sources and proposal, then records an accept/reject decision through the supported approval flow. This decision applies only to the shared plan. It does not approve any external message, booking, purchase, calendar change or private-data disclosure.
6. **Read across an authorized client.** A second participant uses their own supported AI/account to retrieve the saved proposal and owner decision with the correct source, author, audience and version. Verify that an unauthorized role cannot see the proposal or decision.
7. **Try the privacy boundaries.** Use only approved harmless test prompts. Confirm a child cannot access a parent-private or owner-only room, another member cannot impersonate the author, and revoked or stale access is denied. Never ask a child to probe a real private record.
8. **Repeat a second useful workflow.** Choose another harmless planning item and repeat retrieval → sourced proposal → owner review → cross-client readback without developer assistance. Measure elapsed time and count owner interventions; do not include message text or account details in public evidence.
9. **Close the session safely.** Remove any temporary synthetic task or test consent according to the reviewed recovery instructions. Do not enable integrations, scopes or sharing that were not part of the approved pilot.

Stop immediately if identity or audience is unclear, a source is unexpectedly visible, an operation asks for broader permissions, a write has an uncertain outcome, a new charge appears, the client cannot use the documented supported operation, or a participant is asked to share authentication codes. Preserve the ambiguous operation for owner review; do not retry an uncertain write blindly.

## Evidence record

Keep the detailed record in a restricted owner-controlled location. The public issue should contain only a sanitized summary like this:

| Field | Public value |
| --- | --- |
| Pilot date | Date only, if the owner wants it recorded |
| Client capability | Supported / blocked; no account or plan identifier |
| Participant checks | Adult A, Adult B, Child A, Child B — pass / blocked; no names or emails |
| Task/proposal receipt | Pass / blocked; do not include IDs or contents |
| Source, author, audience, version readback | Pass / blocked |
| Owner approval boundary | Pass / blocked |
| Duplicate retry and stale-write behavior | Pass / blocked |
| Cross-client retrieval | Pass / blocked |
| Private-room denial | Pass / blocked; no private request or response text |
| Second workflow | Pass / blocked |
| Elapsed time and owner interventions | Aggregate counts only |
| Unexpected cost, message, booking or permission change | None / incident; details go to the restricted owner record |

Never attach screenshots, private trip itineraries, participant emails, OAuth tokens, private AI conversations, personal records, diagnostic payloads, or source permission exports to this issue. A blank template or a mock-provider test is not live acceptance.

## Acceptance decision

Issue #37 can be accepted only when each participant has completed one useful contribution through their own verified supported AI, the owner has reviewed and decided a sourced proposal, a second authorized participant has retrieved that decision with provenance, the role boundaries have passed, and a second workflow succeeds without developer assistance. Record the aggregate time and interventions and have the owner confirm the flow was useful.

Passing CI, merging the integration, observing a deployment, using one person's account, or completing a website self-check does not satisfy these criteria. If any required client or participant is blocked, keep #37 open and record the missing capability or sanitized pass/block status. The final decision to accept usefulness belongs to the owner and participants.

