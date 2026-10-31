# Recover an uncertain feedback publication

An owner can select **All reports**, open an uncertain report, and check GitHub
for its exact Feedback ID. Enter the existing issue number and choose **Verify
and link existing issue**. This performs one authenticated GitHub GET, never an
issue creation or retry. The issue must be in the fixed repository and its title
and complete body must exactly match the encrypted, previously approved intent.
Edited, missing, oversized, redirected or denied responses leave the report
uncertain. Verify manually rather than creating another issue.

The completion update matches the saved intent and uncertain state atomically.
Concurrent verification of the same issue is idempotent; a different link or a
changed intent is rejected. Non-owners cannot use the endpoint. The token stays
in the Worker secret binding; screenshots and private reports are not fetched
from GitHub or republished. No migration or extra provider permission is needed.

This does not recover a crashed request still marked `publishing`, establish that
no manually duplicated issue exists, or restore a deleted/edited public issue.
Those cases require owner investigation. Synthetic SQLite and browser tests are
separate from live recovery acceptance. No production rollout is implied.
