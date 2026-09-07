# Causent technical review

**Judgment:** retain the relational core and explicit evidence contracts. Fix measurement integrity and bounded reads before adding customers. The application has substantial defensive engineering. It remains a controlled demo product, not a general multi-tenant measurement service.

Review date: September 6, 2026. Baseline: `main@2c2b1bfd9b91e5250d4736a6d1b1e341812aa29f`, verified against GitHub's branch endpoint during this review. The open checkout is older: `95c3c07`. Existing local edits were preserved. An ordinary temporary source export was used for analysis and tests; no branch, worktree, commit, or application change was created.

## Evidence standard

**Reproduced** means a local execution demonstrates the behavior. **Source-established** means the code or migration permits it; deployed behavior has not been tested. **Design risk** means the contract cannot establish the intended claim without additional assumptions. Findings are not a claim that production has been compromised.

P1: address before handling consequential customer data or promising measured impact. P2: address before expanding workload or workflow. No blanket rewrite is recommended.

## Findings

### T01 · P1 · Latest evidence and metric history can be silently truncated

**Source-established; import boundary reproduced.** `getMetricRecords` reads each metric in ascending date order without pagination. `loadEdgeReadouts` fetches all nodes, edges, and evidence without pagination or a latest-row SQL projection, then selects the newest evidence in JavaScript. The repository sets the API row cap to 1,000. The CSV parser accepts 2,000 observations; a 1,500-row import passed the reproduction.

A metric with 1,500 observations can render its first 1,000 days and omit recent data. More seriously, the graph reader can combine a current edge's direction with an older evidence row drawn from an incomplete result set. Adding indexes does not repair this result contract. The hosted row-cap setting was not inspected.

**Action:** bounded date windows and keyset pagination; a database read model selecting the latest evidence per edge and method; one coherent evaluation ID linking direction, interval, and provenance. Return completeness metadata. Test beyond the cap and across equal timestamps.

Evidence: [metric reads, lines 54–78](https://github.com/Causent-AI/causent-ai/blob/2c2b1bfd9b91e5250d4736a6d1b1e341812aa29f/lib/data/metrics.ts#L54), [graph reads, lines 71–126](https://github.com/Causent-AI/causent-ai/blob/2c2b1bfd9b91e5250d4736a6d1b1e341812aa29f/lib/data/graph.ts#L71), `supabase/config.toml:18`. Supabase documents the [default row cap and pagination](https://supabase.com/docs/reference/javascript/select).

### T02 · P1 · Ordinary members can write purported engine evidence

**Source-established.** The RLS contract grants members INSERT on evidence and INSERT/UPDATE on causal edges within their scope. An evidence row may declare `methodology='ITS'`; the examined migrations do not restrict that value to a verified engine execution. Append-only protects existing rows from ordinary updates. It does not establish the authenticity of a newly appended result. A member can also change an edge's belief and direction directly.

**Action:** separate human/manual assertions from computed evidence. Restrict computed-result writes to a narrow worker capability or checked RPC. Bind every result to the exact scope, input manifest, model version, and evaluation run. User identity remains attribution context, not authority to mint machine evidence. Preserve RLS for reads and tenant scope checks. Prove the boundary with a member-versus-worker adversarial integration test.

Evidence: [policies, lines 209–239](https://github.com/Causent-AI/causent-ai/blob/2c2b1bfd9b91e5250d4736a6d1b1e341812aa29f/supabase/migrations/20260703223628_v1_rls.sql#L209), `20260709000000_grant_base_privileges.sql`, and `engine/persistence/bridge.py:191`. Supabase distinguishes [role authentication from row authorization](https://supabase.com/docs/guides/database/postgres/row-level-security). This review did not attempt a production write.

### T03 · P1 · Two repositories can collapse into one PR identity

**Reproduced.** PR 42 in `acme/app` and PR 42 in `acme/api` both become `github:pr:42`. The database deduplicates by scope and external reference. Importing both into one workspace can discard the second action.

**Action:** use provider installation/repository identity plus entity kind and provider entity ID. Migrate existing references with a collision report; preserve old IDs as aliases. Test same-number PRs in two repositories and renamed repositories.

Evidence: [parser, line 263](https://github.com/Causent-AI/causent-ai/blob/2c2b1bfd9b91e5250d4736a6d1b1e341812aa29f/lib/ingest/github.ts#L263), `lib/ingest/github-store.ts:25`, [reproduction](verification/contracts-results.json).

### T04 · P1 · A concurrent duplicate can discard fresh rows in the same import batch

**Source-established.** The store inserts a batch. On any unique violation it returns zero and treats the operation as an idempotent success. A duplicate introduced after the pre-read can reject the entire statement, including non-conflicting new actions. A later complete replay may recover them; this invocation does not.

**Action:** use an atomic conflict-aware insert on the canonical identity, with explicit inserted/duplicate/rejected counts. Test a mixed duplicate/new batch under concurrency. Do not catch every unique violation as the intended identity conflict.

Evidence: [store, lines 38–47](https://github.com/Causent-AI/causent-ai/blob/2c2b1bfd9b91e5250d4736a6d1b1e341812aa29f/lib/ingest/github-store.ts#L38).

### T05 · P1 · The 201st eligible action breaks causal recomputation

**Reproduced at engine boundary; bridge path source-established.** The bridge loads every workspace action within the metric's full date range and calls a batch function capped at 200. Targeting one active report narrows persisted outputs, not the computation family. Unrelated historical actions still consume the cap. Repeated ingestion can therefore make a previously valid workspace unmeasurable.

**Action:** define an explicit, versioned hypothesis family before optimizing it. Bound the analysis window and eligible interventions by scientific intent. Preserve valid multiplicity control across any computational partition. Do not simply increase the cap or split batches independently and claim unchanged statistics.

Evidence: [family query, line 108](https://github.com/Causent-AI/causent-ai/blob/2c2b1bfd9b91e5250d4736a6d1b1e341812aa29f/engine/persistence/bridge.py#L108), `bridge.py:334`, [reproduction](verification/science-results.json).

### T06 · P1 · Statistical significance cannot identify the responsible work

**Design risk; synthetic counterexample reproduced.** The model fits one series around an intervention date. It includes time, a step, and—in longer series—a post-intervention slope. It does not observe an untreated comparison or external co-intervention. A simulated external shock of 20 units, with zero true PR effect, produced a 20.064-unit estimate and `belief=1.0`. That is an identification limitation, not evidence of a population false-positive rate.

The code correctly includes an observational caveat. The caveat cannot convert a time break into proof that a PR caused it. Measuring the effect of work also does not identify the incremental value of AI assistance versus performing the same work without AI.

**Action:** choose the estimand and design before fitting. Add exposure, rollout timing, plausible controls, concurrent changes, lag, and pre-specified decision thresholds. Permit “cannot attribute” as a terminal useful result. Use randomized or controlled designs where available; retain ITS for suitable cases. [ITS methodology](https://pmc.ncbi.nlm.nih.gov/articles/PMC5407170/) explains why concurrent events and seasonality require attention.

Evidence: [model](https://github.com/Causent-AI/causent-ai/blob/2c2b1bfd9b91e5250d4736a6d1b1e341812aa29f/engine/causal/segmented_ols.py#L65), `engine/causal/types.py:54`, [simulation](verification/science-results.json).

### T07 · P1 · The package breakpoint can include treated days in its baseline

**Design risk; synthetic illustration reproduced.** A multi-action package becomes effective at its latest included completion date. Earlier actions may already have changed the metric. Fitting one break at the final date does not estimate the whole package relative to an untreated baseline.

In a synthetic package adding 20 units on day 70 and 10 on day 100, the final-date fit estimated 11.623 units rather than the known total 30. The autocorrelation gate withheld a confident result in this example; the product therefore protected confidence but did not recover total package value. Gradual rollouts and adoption delays deepen this mismatch. PR merge time is also used as an effective date in the backfill parser, without evidence of deployment or exposure.

**Action:** record first exposure, rollout schedule, completion, and expected lag separately. Either restrict packages to a coherent intervention or model staged exposure explicitly. Define the post-period outcome of interest: immediate step, cumulative effect, or effect at a horizon. [Methodological guidance](https://www.bmj.com/content/350/bmj.h2750) warns against treating gradual or multiple interventions as an ordinary single interruption.

Evidence: [package rule, line 318](https://github.com/Causent-AI/causent-ai/blob/2c2b1bfd9b91e5250d4736a6d1b1e341812aa29f/supabase/migrations/20260817055407_decision_report_scientific_contracts.sql#L318), `engine/persistence/recompute.py:173`.

### T08 · P1 · Percentage scale and business desirability are guessed

**Percentage defect reproduced; desirability source-established.** Display code treats an entire percent series within ±1 as ratios. A metric stored as percentage points at 0.5% therefore displays a 0.1-point lift as **+10.0pp**. Unknown metric names also default to `higherIsBetter=true`; a new cost or failure-rate metric can receive the wrong business interpretation.

**Action:** immutable metric-definition versions containing unit, scale, denominator, aggregation, timezone, and desired direction. Require explicit confirmation during import. Do not infer semantics from value magnitude or metric name. Carry the same definition through prediction, model, display, and export.

Evidence: [display, line 32](https://github.com/Causent-AI/causent-ai/blob/2c2b1bfd9b91e5250d4736a6d1b1e341812aa29f/lib/data/readout.ts#L32), `lib/impact/report-impact.ts:76`, `lib/data/metrics.ts:85`, [reproduction](verification/contracts-results.json).

### T09 · P1 · Recompute identity omits the model version

**Source-established.** The input hash contains observations, actions, levers, and package context. It does not include engine version, inference parameters, or the confidence policy. Equal hashes skip computation. An engine change with identical data can therefore retain an old result even after a new generation is requested. Evidence stores useful statistics but lacks a complete immutable evaluation manifest.

**Action:** hash data snapshot, metric definition, intervention, hypothesis family, method/configuration, and code version. Persist that manifest with each evaluation. A deliberate policy change must create a new result, not silently reinterpret old evidence. Keep superseded evaluations queryable.

Evidence: [hash, line 53](https://github.com/Causent-AI/causent-ai/blob/2c2b1bfd9b91e5250d4736a6d1b1e341812aa29f/engine/persistence/recompute.py#L53), `recompute.py:384`, `bridge.py:191`.

### T10 · P1 before customer expansion · Workspace selection remains fixture-bound

**Source-established.** The current session intersects accessible database workspaces with two server-owned demo IDs. This is a sound constraint for a synthetic partner environment. It is not organization provisioning or a general customer tenancy model. Unknown legitimate workspaces are discarded.

**Action:** implement explicit customer organizations, membership-based workspace discovery, provisioning, scoped connectors, and workspace lifecycle. Validate separate organizations—not just two workspaces in one organization. Preserve current cookie verification and RLS. No cross-tenant leak was demonstrated in this review.

Evidence: [workspace context](https://github.com/Causent-AI/causent-ai/blob/2c2b1bfd9b91e5250d4736a6d1b1e341812aa29f/lib/auth/workspace-context.ts#L21), `workspace-selection.ts:29`, `lib/data/config.ts:18`.

### T11 · P2 · Queue correctness holds locks during analytical work

**Source-established; capacity impact unmeasured.** Recompute locks the job, report, series, workspace, and activation before loading full inputs, hashing, and fitting. The same transaction commits evidence and the generation receipt. This is strong consistency at a price: slow analysis can block user mutations on that workspace. Work also reloads observations for hashing and fitting.

**Action:** measure lock duration now. At the scale trigger, claim a leased job, build an immutable input snapshot, compute outside the write transaction, then compare-and-swap the still-current generation in a short commit. Discard stale work. A queue alone does not remove lock contention. PostgreSQL's [SKIP LOCKED contract](https://www.postgresql.org/docs/17/sql-select.html) supports queue consumption, not arbitrary snapshot consistency.

Evidence: `engine/persistence/recompute.py:93–169,228–281,354–404`.

### T12 · P2 · One invalid resolution target can interrupt a batch

**Source-established.** Due workspaces are selected in ID order. Actor lookup throws when a selected workspace has no eligible member; concurrent mapping propagates that rejection. A persistent invalid workspace can prevent the batch from reaching other targets.

**Action:** per-workspace failure receipts, quarantine/retry scheduling, progress cursors, and fairness. Preserve fail-closed authorization while allowing unrelated valid jobs to proceed. Test a poison workspace followed by valid workspaces.

Evidence: `lib/resolution/cron-scopes.ts:160–229`.

### T13 · P2 · Paid generation lacks an application admission budget

**Source-established in reviewed route and library.** Generation has authentication, input limits, a timeout, and bounded retry. The searched application code does not enforce per-tenant spend or concurrent-generation quotas. A legitimate account can submit many valid requests. Provider-side quotas and deployed firewall rules were not inspected.

**Action:** tenant/user admission limits, concurrent-request caps, cost ceilings, cancellation, and idempotent request receipts. Measure cost per retained customer and useful decision, not just token consumption. Return an actionable budget state.

Evidence: `app/(onboarding)/onboarding/decision-report-actions.ts:55–175`, `lib/decision-reports/generate.ts:25`, `generation-policy.ts:13`.

### T14 · P2 · The learning layer is descriptive, not a validated compounding model

**Source-established; contract discrepancy reproduced.** Priors aggregate resolved outcomes with ordinal belief scores as weights. They do not estimate calibrated uncertainty, counterfactual decision value, or out-of-sample improvement. A class containing only an inconclusive result with weight 0.5 returns a numeric mean, despite the file's stated rule about withholding without confident weight. `belief=1.0` is a policy bucket, not a calibrated probability of causation.

**Action:** retain the useful history panel but name it accurately. Track forecast calibration, recommendation acceptance, decision change, realized utility, and evaluation coverage. Validate transfer within comparable mechanisms before pooling across teams or industries. Do not market graph size as learning quality.

Evidence: [prior computation](https://github.com/Causent-AI/causent-ai/blob/2c2b1bfd9b91e5250d4736a6d1b1e341812aa29f/lib/priors.ts#L66), `engine/causal/belief_direction.py:41`, [reproduction](verification/contracts-results.json).

## What deserves preservation

- **Explicit authority:** typed report state, human prediction, reviewed activation, stale-revision conflicts, and immutable activation bindings. Generation does not itself create a causal result.
- **Evidence discipline:** exact-source quotation checks, private receipts, sanitized images, and append-only report/evidence history. Fix the computed-evidence writer boundary without discarding the audit architecture.
- **Scientific restraint:** the 45-observation-per-side gate, HAC intervals, placebo screen, autocorrelation cap, and within-batch FDR are materially better than an unqualified before/after chart. They constrain error under assumptions; they do not establish those assumptions.
- **Durable execution:** connector inbox deduplication, conflict detection, retries and dead letters; coalesced recompute generations; atomic result/receipt commits; dedicated worker roles and fixed privileged-function search paths.
- **Operational progress:** application, engine, isolation, build, and deployment-contract CI; staging load harness; explicit seed mode; visible database failures; separate worker deployments.

The old checkout lacks several of these improvements. Historical review findings were reconciled against main rather than copied as current defects.

## Coverage and limits

| Area | Examined | Remaining evidence |
|---|---|---|
| Front end | Dashboard loaders/shell; report editor boundaries; action/impact view models; current-state selection; read-only live demo inspection of five views | Mutation acceptance, mobile and accessibility testing remain unverified; see FRONTEND_ANNOTATIONS.md |
| Server and sources | Generation actions; URL parsing/DNS controls; PDF/image boundaries; signed asset delivery; source receipts | Hosted rate limits, provider configuration, active abuse tests |
| Data/security | Migration sequence; RLS/grants; privileged-function hardening; worker roles; activation/package contracts | Fresh isolated database replay and role tests; production catalog verification |
| Ingestion | GitHub parsing/store; GitHub/Jira route contracts; durable inbox; CSV parsing | Real provider replay, deployment/exposure verification, large authenticated import |
| Science | ITS, belief, FDR, package anchor, bridge, resolution, prior aggregation | Representative causal benchmark, concurrent events, missingness, seasonality, repeated-look policy |
| Scale | All-history read paths, job locking, retry contracts, cron batching, load harness | k6 run, query plans on large fixture, queue/connection measurements, restore drill |
| Delivery | Main verified via GitHub; CI source inspected; local checks run | Hosted CI execution and production parity not re-verified |

**Executed:** 620/620 application pure tests across 64 files; 1,085/1,085 engine pure tests across 26 files; 15/15 load-contract tests; TypeScript and zero-warning lint passed. Reproductions and logs are in [verification](verification/baseline.json). Node was 26.5.0, not pinned 22.23.0; Python was 3.14.2, not CI's 3.12. Dependencies were reused from the existing matching-source worktree. These results supplement, not replace, pinned-toolchain CI. No full build, database reset, production write, or load test was run in this pass.

**Order of work:** evidence authenticity and display correctness → canonical ingestion identity → complete bounded reads → explicit intervention/metric contracts → real customer isolation → measured scale changes. The most expensive failure would be a fast, polished, well-tested answer to the wrong causal question.
