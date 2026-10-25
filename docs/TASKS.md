# Daily task and assistant workflow

Use Plan & approvals → Family tasks for daily coordination. Add a task, choose an audience, responsible person and assistant, record the source, then follow its progress. An assistant choice creates a manual handoff, not an API call. The owner is the only task approver. Completion requires a result/source note and any required approval.

Task approval is a recorded decision. It never sends a message, creates an event, books or purchases anything. Calendar/email actions retain their separate exact-action approvals. Clipboard copying is an explicit user action with a reviewable prompt; no assistant receives data automatically. ChatGPT and the four consumer Copilot selections use existing accounts manually. For Hub coordinator tasks, Open in coordinator chat prepares a draft in the matching room, preserves other drafts and sends nothing until the user reviews and selects Ask coordinator. The existing pilot quota still applies. Muse is excluded.

## Audience and provenance

Family tasks are visible to all four members; Parents tasks are visible only to the adults. Parents tasks cannot be assigned to children or their assistant handoffs. The server supplies stable creator identity, source=hub, creation/update timestamps and approver identity. The source note and completion note are user-provided evidence, not instructions or proof that an AI answer is correct. Every user must review what they paste into an assistant.

A creator, assignee or owner can update work status. Only the owner can approve/reject. Required approval cannot be removed by a status request, and a task cannot be completed without approval and a result note. Optimistic versions stop stale decisions and concurrent overwrites. A repeated create with the same ID and scope returns the original task; changed or cross-person reuse is rejected. Retrying after a lost response does not create another task. Limits are 20 new tasks per person per UTC day and 1000 retained tasks total, with no paid fallback.

## Existing intake inventory and decision

| Existing workflow | Daily path | Existing resource |
| --- | --- | --- |
| Family onboarding | Authenticated Hub guide and one useful task per person | Keep the existing restricted onboarding Form optional |
| Family task intake | Hub task form and task list | Keep the existing restricted intake Form optional |
| Parent approval review | Owner task approval and separate external-action approval | Keep the existing parent-only approval Form optional |
| Coordination Board / private queue | Historical/reference workflows | Preserve existing sheets and permissions |

The existing Board and private queue metadata were inventoried, and all three Forms' editor/responder restrictions were reviewed separately. A Drive search result is not a complete Apps Script inventory. Before installing or retiring automation, inspect the authorized account's Apps Script dashboard, project triggers and recent execution statuses. Review handler code without running it, and distinguish a completed invocation from verified response processing. Keep project IDs, account mappings, private queue contents, trigger exports and family assignments out of public evidence.

Preserve optional legacy private intake while using Hub tasks for daily coordination. Do not add duplicate polling or notification paths. A legacy response must be reviewed before manually creating a Hub task unless an explicit supported synchronization has been implemented and authorized. Inspect deduplication, locks, source access and quarantine behavior before relying on an intake handler. A notification draft is not a sent notification. Record which project/account the private audit covered; other accounts' private triggers remain outside that evidence.

## Singapore adoption trial

Use a harmless request such as “Find two free Seoul layover activities and verify official opening hours and transit time.” Each person creates or accepts one Family task, reviews a manual assistant handoff, brings back sources/uncertainties, and records a completion note after the owner decision. Use the approved private trip brief on the device; never put passport, payment, medical or private AI conversation data into Family tasks or public GitHub evidence. No bookings or purchases are part of the trial.

The family-device trial requires the actual family members' sign-ins. Synthetic tests cover storage and boundaries but do not substitute for their adoption feedback.

## Rollout

Review the PR and apply only the additive `0009_tasks.sql` migration to the existing restricted database before deploying the task UI through the validated pipeline. Do not implicitly run unrelated pending migrations. This change does not alter sharing, credentials, existing records or subscription billing. Schema rollout and live acceptance have not been performed by the coding tests.

Regression tests cover persisted provenance/status/approvals, family/private boundaries, forbidden child handoffs, invalid identities, aliases, concurrent decisions and creates, rate limits, manual-only delegation, preserved drafts, room races, authentication denial and save/refresh failure separation. Tests use disposable SQLite and mocked devices/providers.

Retained tasks are paged with an opaque creation-time/ID cursor, including completed tasks. Completion-note drafts stay with their room and task across refreshes until confirmed save or explicit discard. If a create response is lost and the user edits the draft, Recover previous save replays the immutable original with its same ID before assigning a separate ID to the preserved edits; the new draft requires audience review again. A failed initial identity lookup can be retried with Refresh.

## Family acceptance handoff

Each member signs in independently on their own device; never share login codes. In Settings, open Check my access and run the five checks, then verify the displayed person and role. Adults may use Parents private; other members may use Family only. Each member chooses whether to enable notifications, sends their own generic test, and checks notification history as well as banners. An accepted push and a displayed notification are separate results. Windows Do not disturb and app banner settings can affect presentation.

For the Singapore trial, each person chooses a small research task such as activities or a layover comparison. Record a responsible person, audience, source and assistant, and retain any required owner approval. Consumer assistant selection is a manual handoff. A successful synthetic owner workflow test proves persistence and draft preparation only; it does not prove other members' adoption or the accuracy of travel research.
