# Factory claim observation (review-only)

The internal D1 observation helper reads and validates the single claim slot for later recovery work. Missing, duplicate, malformed, or unavailable results fail closed with a generic error. It does not modify the row or expose a route, binding, migration, dispatch, release or resume operation.

A snapshot may already be stale when returned. It is not evidence that a provider task is terminal and must never by itself authorize another run, a lock release or a resume. A future recovery flow needs trusted provider correlation, current approval and budget checks, and atomic conditional state transitions. No production integration or live verification is supplied by this helper.
