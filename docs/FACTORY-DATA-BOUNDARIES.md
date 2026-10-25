# Coding-agent data boundary

A public repository is not automatically a safe coding-agent input. Factory execution remains disabled until the owner approves a provider and a bounded, sanitized source manifest. This document supports #39; it does not authorize dispatch, credentials, publication, deployment or historical cleanup.

## Allowed inputs

- Individually reviewed text source files required for the frozen issue scope.
- Synthetic tests, public dependency metadata and public primary documentation.
- A sanitized task description containing acceptance checks, allowed files and the current owner approval reference.

Do not supply production databases, Google records or identifiers, personal email mappings, private chats, feedback attachments/screenshots, raw diagnostics, provider credentials, local credential stores, authenticated browser profiles, deployment tokens or unrelated environment variables. An owner approval reference is evidence to verify, never a credential. A feedback publication approval does not authorize exposing its private attachments to a coding agent.

## Read-only preflight

Create a manifest outside the proposed sandbox containing exactly one `files` array of repository-relative paths, for example:

```json
{"files":["scripts/runtime.mjs","test/runtime.test.js"]}
```

Run with the repository's `.nvmrc` Node version:

```sh
node scripts/factory-input-audit.mjs /path/to/reviewed-source /path/to/manifest.json
```

The command reads only selected files and prints aggregate classes/counts. It exits zero only when every selected input passes. A rejected input, unreadable file, link, unsupported encoding, oversized file or malformed manifest exits nonzero. There is no export, sanitization, network access, provider call or credential lookup. No workflow has been wired to dispatch or to treat this check as authorization.

The path allowlist covers selected source/test/docs and workflow text, plus a small set of root metadata files. It rejects path traversal, absolute paths, credential/data directories, binary attachments, generated output directories and links. Contents are checked for candidate personal email addresses, Google resource references, credential-like values and infrastructure identifiers. Documentation examples should use reserved example domains. Synthetic fixtures may intentionally trigger findings; any exception requires review and a separate sanitized copy, never an automatic skip.

This is a conservative preflight, not a complete secret scanner or authorization boundary. It cannot recognize all secrets, obfuscation, private prose, identifiers without context or malicious dependency behavior. Passing does not mean an input is safe. A controller must use an immutable reviewed source snapshot, verify file digests, and export only that exact approved content into an isolated sandbox; do not run this tool against a concurrently modified or adversarial filesystem and then copy paths later. Symlink checks alone do not eliminate filesystem races. The controller must recheck source scope and owner approval at dispatch.

## Bounded source/workflow review

Reviewed main source snapshot: `dbe4cb233d8ecdd28e088ce2ccab41bf24ebfc2d`.

A manifest selected 71 tracked text files under source, public, scripts, tests, docs and workflow directories, excluding generated asset/vendor/version output. Their local Git blob hashes matched that main tree. This was not a scan of every repository object. The preflight returned **fail**: 69 files checked, two disallowed input paths, and candidate findings in three classes: credential-like values (3 files), personal email addresses (15 files), and private Google references (2 files). These are candidate classes and per-file counts, not confirmed credential exposures. Synthetic test fixtures can trigger the same rules. Matched values and locations are deliberately absent from this public report. The existing source snapshot must not be given wholesale to an agent merely because it is already public.

Current checked-in workflow review:

| Workflow | Permissions and boundary | Remaining gap |
| --- | --- | --- |
| `factory-plan.yml` | Contents/issues/PR read; main and repository guard; manually invoked; pinned actions; checkout does not persist credentials; ten-minute timeout | Runtime uses a read token for issue collection. It must not be forwarded to a coding sandbox. This workflow is a planner, not an execution controller. |
| `validate.yml` | Contents read; pinned actions; checkout does not persist credentials; ten-minute timeout; no explicit production secret injection | Executes package installation and tests. Read permissions do not prove dependency or environment isolation; no coding-agent sandbox was inspected. |

## Gates before the first factory trial

- Privately classify candidate findings, including synthetic false positives; review issue bodies and source metadata as inputs.
- Put any required private runtime configuration behind separately reviewed configuration changes. Do not re-upload existing private values as part of a cleanup PR.
- Review relevant history and generated artifacts privately. Propose any revocation or history remediation for exact owner approval; do not force-push or revoke credentials automatically.
- Verify the chosen coding environment has no production credentials, live data mounts, inherited browser session or unreviewed connected sources. Use a source allowlist and least-privilege task credentials.
- Freeze approved source digests and task scope, run this preflight against that immutable snapshot, and review its result together with provider cost controls before enabling a synthetic/public-source trial.

History, workflow artifacts, provider environment configuration and a live agent sandbox remain **unverified**. Issue #39 stays open until those gates have evidence. The scanner's passing synthetic regressions are not evidence that a production sandbox or the entire repository is safe.
