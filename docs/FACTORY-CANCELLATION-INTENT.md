# Durable cancellation intent (review-only)

The unbound claim store can record cancellation intent for the exact operation and scope digest, including while paused or uncertain, before a task identity is available. The conditional write never clears the slot or sends a provider request. Intent remains set if later task identity evidence arrives or a worker restarts.

A false or ambiguous write is not proof that intent is absent and must not authorize a retry or another run. No provider stop path is implemented: any future adapter must establish authoritative correlation and confirm both task and run terminal status before considering release. The schema is a review fixture, not a migration; upgrading existing databases requires a separately reviewed migration and activation.

Cancellation recorded before the pre-start uncertain transition prevents that transition. If the transition wins the race first, later cancellation is still retained; the controller must recheck cancellation immediately before any external call. A database check cannot atomically cancel an already-started external request.
