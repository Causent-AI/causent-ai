# T11–T14 implementation and UX review

Baseline: merged PR #34, `dd1901d`. User approved implementation alongside a UX recommendations pass. The proposed report redesign remains a review artifact.

## Build phase

1. **T13 — generation admission.** Database-backed tenant/user concurrency, a rolling request cap, conservative daily spend reservations, durable request identity and replay, cancellation, and actionable denials. Keep authorization and source receipts. No provider call before admission. Failed, cancelled, and expired calls retain their reservation because provider billing can be uncertain.
2. **T12 — resolution fairness.** Persist per-workspace attempts with leases, retry timing, and safe failure codes. Claim oldest eligible work first; isolate actor and downstream failures. Preserve member authorization and independent progress.
3. **T11 — recompute timing.** Record claim wait, time holding the job lock, input loading, and analytical work. Measure the isolated fixture. Preserve atomic generation/evidence commits; document the measured trigger and snapshot/CAS design for a later lock-shortening change.
4. **T14 — honest history.** Repair the all-inconclusive aggregate, reject malformed/nonfinite tuples, keep observational outcomes excluded, expose evaluation coverage and descriptive forecast errors, and label the UI as historical evidence. Define prospective learning validation without claiming it has occurred.

## Test phase

- Pure regression tests for cancellation, request identity/reservations, poison-workspace isolation, history semantics, and timing.
- Isolated database tests for concurrent admission/leases, tenant and actor isolation, replay/cancellation, retry fairness, service-only ACLs, and migration lint.
- Application and engine suites, types, zero-warning lint, production build, dashboard and load contracts.
- Read-only desktop/mobile UX inspection of Data, Reports, the full report, Actions, and Impact; proposed document mockup and prioritized recommendations.

## Delivery

Engineering review and UX recommendations include evidence, acceptance criteria, release requirements, and unverified human/production gates. No migration or worker change is applied to production. Conditional push authorization follows successful required checks; merging remains the user's action.
