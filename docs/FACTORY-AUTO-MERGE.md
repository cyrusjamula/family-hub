# Copilot auto-merge reconciliation

The repository-native workflow preserves its existing policy: a non-dismissed Copilot review of the exact current head enables the `copilot-review` gate, and all remaining rules/checks still apply. It may register squash auto-merge under the owner's configured policy. It never invokes a direct merge operation.

GitHub has rejected `enablePullRequestAutoMerge` for an already clean PR with the exact single `UNPROCESSABLE` message `Pull request Pull request is in clean status`. The reconciliation now rereads the PR state/head, warns that the owner must perform the merge action if it is still the same open non-draft PR, and continues to other PRs. It does not retry that rejection, claim auto-merge was enabled, merge the PR, or weaken any review/check requirement. If the PR changed or closed, it records that observation instead.

Only that exact single-error response is handled this way. Permission failures, multiple/ambiguous errors and unrelated failures remain visible workflow errors. Existing bounded unstable-status retries retain their fresh-head and fresh-review checks. Clean status is not a new approval signal and does not replace checks or user acceptance.

This fixes the per-PR queue failure observed in workflow run 40641765175/job 122661301090. The workflow loads code from its trusted workflow revision; a PR changing this script cannot change the privileged workflow's current behavior before it is reviewed and merged. No workflow rerun, merge, deployment or policy activation is performed by the tests.
