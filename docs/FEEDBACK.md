# Feedback and GitHub triage

The header's Feedback button is available to signed-in family members. It opens a small form rather than adding another main navigation tab. A user writes a title/details, optionally includes the current app section and permits their first name in a public issue, previews the report, and explicitly submits it privately for owner review. Their verified person identity is recorded on the server regardless of whether they permit public attribution. Clients cannot supply a reporter identity or role.

Opted-out section context is not transmitted. Conflicting simultaneous report IDs return HTTP 409; HTTP 429 is reserved for the daily intake cap.

Nothing captures messages, records, logs, location, URL/query parameters, or screenshots automatically. The optional app context is one of Chat, Plan & approvals, Settings, or Advanced; non-owners cannot claim Advanced context. Text intended for the report is never copied from another view.

## Optional screenshot

The user opts in before selecting and reading an image. A local pixel-only canvas preview appears before submission; a DOM-selected file is never used as a blob URL in an HTML image sink. This requires browser support for createImageBitmap; otherwise submit without an attachment. Revoking permission, closing the form, or changing a reviewed field discards the prepared preview. A late file-read callback cannot restore a revoked attachment. PNG, JPEG and WebP files are limited to 150 KB; the server checks the type, signature and size and rejects SVG/HTML and other unsupported data. Users must remove sensitive content and metadata before choosing an image. The original filename is not stored. The feedback vault uses the existing AES-GCM record format with chunk-safe base64 so images at the full accepted 150 KB size round-trip.

Report text and screenshots are encrypted in D1 using the existing vault key and distinct purpose/owner/report associated data. Only the reporter and owner can retrieve a report or image. An adult does not inherit access to another adult's or a child's reports. Images have no public object-storage URL, and do not go to AI or GitHub. A GitHub issue links to the restricted Hub report; sign-in and report authorization are still required. Keep the vault key unchanged.

## Owner publication

Owner triage defaults to pending reports so completed reports cannot crowd out the queue. Both pending and all-report views have stable keyset pagination with Next/Previous navigation. Restricted report links automatically expand the enclosing triage panel.

Open Feedback → Your reports / owner triage. Review the report and image, redact the public title/details as needed, then choose Preview GitHub issue. The exact repository, public title/body, attribution, and restricted report link are displayed. A separate explicit approval creates one issue in `cyrusjamula/family-hub`. Changes to public text invalidate its preview/approval. Public text neutralizes `@` mentions and raw HTML brackets to avoid pinging people or injecting raw markup. Only an explicitly permitted first name is included; other identity stays private.

Submission IDs make network retries idempotent and aliases share the same per-person limit of five reports/day. Publication atomically claims a pending report once. Repeated/concurrent publication cannot send twice. Any timeout, redirect, unexpected provider response, or completion-write failure leaves an uncertain/claimed report and never automatically retries. Search GitHub for the Feedback ID before taking manual recovery action; do not blindly create another issue. Rejection only applies to pending reports.

The feedback script adds its canvas and queue controls to the existing form using DOM creation APIs. The tracked `src/assets.js` is a fail-closed placeholder; validated builds regenerate it from `public/` before bundling. Generated copies are build outputs, not source updates. Direct Wrangler runs without the validated build are unsupported.

## Setup and rollout

1. Review/apply additive migration `0007_feedback.sql` before enabling the feature. It does not touch existing records or call GitHub. Existing migration 0006 is also required for authenticated mutation-attempt auditing. Follow the migration review/recovery process in [CICD.md](CICD.md).
2. Use the existing restricted D1 database and vault runtime secret. No new paid service or object-storage bucket is needed.
3. Create an expiring fine-grained GitHub credential limited to this repository with **Issues: write** (metadata read is implicit). Prefer a properly scoped GitHub App installation credential if an authorized renewable integration is available. Do not reuse the ChatGPT connector's credentials, grant organization-wide access, or create a broad classic token.
4. Store the credential as the Worker's runtime secret `GITHUB_FEEDBACK_TOKEN`, never in public source, build variables, logs, chat, screenshots, or browser code. Creating this access requires owner authorization. The supported endpoint is GitHub REST Create an issue: https://docs.github.com/en/rest/issues/issues#create-an-issue . The app calls the fixed repository endpoint and follows no redirects.
5. Set runtime variable `FEEDBACK_ENABLED=true` after the migration and reviewed code deployment. Missing/false disables intake and publication. Missing GitHub credentials still permits private intake but blocks publication, with a clear setup message.
6. Verify with a harmless report, optional non-sensitive screenshot, reporter/owner/other-member permission checks, and an explicitly approved public test issue. Automated tests use only synthetic data and mocked GitHub; they do not provision credentials or create live issues.

At implementation time, no production migration, feature flag, GitHub credential, issue-publication test, or browser/device smoke test has been completed by this change. Keep those rollout checks open. The default remains disabled until setup is completed.

## Telemetry

Issue #14 tracks restricted operational telemetry and correlation IDs. A reporter may optionally add a UUID request reference to the private report; the reference and validated Hub release are stored in its encrypted payload. The owner can review both in triage, and they are included in the exact GitHub preview for explicit approval. No raw logs, browser text, stacks or shared-room content are attached automatically.
