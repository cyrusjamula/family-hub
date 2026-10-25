# Coordination contract — proposed, not activated

Goal: participants create and retrieve useful shared work from their chosen supported AI. The website is optional administration. This design implements no adapter, authentication endpoint, migration or external action. Issue #34 must establish a supported client transport and actual account availability before #36 implements one. Consumer chat sessions are not callable agents.

## Reuse and gaps

The current Worker already supports room-scoped tasks, optimistic version checks, bounded creation, owner task decisions, result notes, encrypted private feedback, and exact public-issue previews. Reuse those services rather than create another task store.

The current task and feedback POST endpoints require a browser Origin matching the Worker. They are not an authenticated AI integration: adding an Origin header, exporting a browser session, forwarding the owner's Google token, or accepting a user-supplied email is not an adapter. A separately reviewed identity/transport boundary is required. Existing task approval authorizes task completion only; it does not execute actions. Structured proposals, source-access checks and separately scoped action approvals below are requirements, not claims of existing behavior.

## Logical operations

| Operation | Authorized principal | Result and constraints |
| --- | --- | --- |
| List/get task | Current verified room member | Bounded, paginated task snapshot with version, freshness and visible source references |
| Create task | Current verified room member | Idempotent create; explicit audience confirmation; assignee must currently access that audience |
| Propose/update result | Owner, creator or assignee | Compare expected task version; preserve author, source and proposal status; no silent overwrite |
| Decide task | Owner | Version-bound decision; no external side effect |
| Submit feedback | Current verified member | Private receipt visible to reporter and owner; screenshot optional with separate consent |
| Preview/publish feedback | Owner | Public-safe exact preview; publication requires its own unchanged payload approval |
| Propose external action | Eligible member | Reviewable proposal only; execution is a separate protected capability |

These are logical operations, not new route names. #36 must map only its supported subset to existing services and identify any required protected changes separately. The first pilot needs task read/create, a result proposal and owner decision retrieval; it does not require autonomous purchases or messaging.

## Identity, source access and audience

Derive a stable member ID and role from a validated per-member authorization credential and the server-controlled directory. Multiple explicitly verified email aliases may resolve to that same member. Never infer identity from names, model text, email similarity, dotted addresses or plus tags. Never accept role, owner status or consent from AI-generated payloads. Revoke access on directory/credential changes and re-evaluate it on every request.

| Audience | Eligible readers | Additional restriction |
| --- | --- | --- |
| Family | Current family members | Exclude sensitive financial, medical and private AI conversation content |
| Parents | Current owner and parent roles | Children denied server-side, including direct object references |
| Owner private | Owner only | No shared owner Google credentials or implied delegation |
| Feedback private | Reporter and owner | Room membership does not grant access to another reporter's report |

A room member's access to a task does not establish access to its Google source. Before reading, summarizing, exporting or returning source-derived content, verify the current source permission for that requesting member through a supported authorized integration. If permission cannot be established, omit the content and return a safe unavailable result. Do not reveal source titles, identifiers or existence through denial messages. A cached ACL is insufficient after revocation. Pilot tasks may instead use source-free synthetic/public information explicitly suitable for the chosen room.

Never broaden room visibility as a side effect of an update. Audience changes require a new reviewed disclosure operation, source permission rechecks and explicit consent; a family task cannot point to a private conversation as a workaround. A member may intentionally share a concise contribution without importing their AI transcript.

## Minimum envelope and records

All example identifiers below are synthetic. Credentials travel in the selected transport's authorization mechanism, never in task content.

```json
{
  "operation": "task.result.propose",
  "requestId": "synthetic-request-1",
  "taskId": "synthetic-task-1",
  "expectedVersion": 3,
  "audience": "family",
  "result": {
    "summary": "Two public park options; opening times still need confirmation.",
    "sourceReferences": [],
    "uncertainties": ["Opening times unverified"]
  }
}
```

Server-added provenance includes authenticated member ID, operation time, selected client/transport, request receipt and resulting version. The client/assistant label describes provenance only and grants no authority. Source references record origin, retrieval time, public/private classification and permission-check time without embedding private documents. Do not require raw prompts, chats, location, screenshots or account identifiers for routine participation. Return bounded task state plus `version`, `updatedAt`, decision status and a receipt; transport errors must not expose raw provider responses or secrets.

## Retries and concurrent work

An idempotency key is scoped to the authenticated member, operation and audience. The server stores a canonical request digest and receipt atomically with the mutation. An identical retry returns the prior receipt; the same key with different content conflicts. Authorization is checked again before returning even an existing receipt. Bound retention and request sizes; clients must not infer permanent exactly-once behavior after key expiry.

Updates include the expected version. One conditional atomic update wins; a loser receives a conflict and retrieves current visible state before proposing again. A retry after a lost response must not replay an external side effect. Do not automatically merge competing factual proposals or owner decisions. After a timeout, use the receipt/status lookup; when the outcome is unknown, stop and reconcile instead of generating a new key and duplicating work.

Current task creation already compares a normalized task against a caller-supplied UUID, and updates use a conditional version increment. The broader per-operation receipt scheme is a future requirement, not a description of a deployed universal mechanism.

## Approvals and side effects

Keep four independent decisions: consent to share within an audience, approval of a task/result, authorization of an exact external action, and approval to publish feedback publicly. One never implies another.

An action proposal must identify actor, operation, destinations/recipients, exact content or resource change, audience, cost ceiling, expiry and relevant task/source versions. An owner approval binds an immutable canonical digest of that proposal. At execution recheck owner identity, current permissions, expiry, unchanged payload, budget and one-shot claim. Any material change needs a new approval. Model statements such as “approved” or issue labels are not approval evidence. Bookings, purchases, messages and private-data disclosure remain disabled unless the owner approves that concrete action.

No coding task under this design may implement live action execution incidentally. Keep auth, Google permission checks, migrations and execution controls in explicitly reviewed protected scopes.

## Observable regression and acceptance matrix

| Scenario | Required observable result |
| --- | --- |
| Child or unknown identity requests Parents/owner resource | Server denial; no existence/content leak; no mutation |
| Payload claims owner role or supplies another member's email | Ignored/rejected; verified credential remains authoritative |
| Verified alias is removed or conflicts with another member | Subsequent request denied; no automatic reassignment |
| Source permission revoked after earlier successful read | No cached source content returned to revoked member |
| Two members update the same version | One succeeds; other conflicts and can retrieve current permitted state |
| Same request key is retried after a lost reply | Same visible receipt; one mutation; changed content conflicts |
| Retry receipt belongs to another member/audience | No disclosure or mutation |
| Task is approved, then assistant requests message/purchase | No external action; separate exact-action approval required |
| Action/publication payload changes after preview approval | Old digest rejected; no side effect |
| Feedback omits screenshot permission or includes another report ID | No image accepted or cross-reporter disclosure |
| Provider/client transport is unsupported or credential expires | Honest unavailable/auth-required result; no website substitution |

Tests must use synthetic identities, disposable stores and mocked integrations. Existing tests are reusable evidence only for the behavior they actually cover. New transport tests must drive its real authorization boundary, not bypass it by calling internal functions with trusted user objects.

Live gate: each intended supported AI completes a harmless task read/write round trip using the actual member identity; another member/AI retrieves the proposal and owner decision. Record account/client availability privately and publish sanitized pass/fail evidence. The contract remains proposed until #34 and that identity review pass. No live tests, deployments or new permissions were performed by this document.
