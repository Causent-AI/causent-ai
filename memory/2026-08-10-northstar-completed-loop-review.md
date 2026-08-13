# Northstar completed-loop review example

## Purpose and locked boundary

- This pass gives the founder a second, fully formed example that demonstrates Causent from
  onboarding through completed work and measured Impact. It is deterministic local review data,
  not partner evidence or a production result.
- Northstar Support uses the existing one-report-metric contract. All three selected actions are
  visibly assigned to **First-week Setup Completion**; only the explicitly pre-registered primary
  lever can receive an action-level causal estimate. Supporting actions remain visible but are
  labeled **Not independently estimated**.
- No connector event, per-action causal result, or additional metric relationship is fabricated.
  The timeline uses the real checked manual-completion dates and keeps its action markers
  descriptive.

## Deterministic example

- The exact Northstar prompt supplies a 40% first-week setup-completion baseline, an approved 55%
  target, named owners and stakeholders, a new-self-serve cohort, and bounded knowledge, escalation,
  organization-data, and customer-content rules.
- The fixture produces a complete Decision, Supporting Evidence, Implementation plan, and three
  detailed actions with owners, priorities, tags, skills, time, and cost. All three actions are
  selected, **Build and stage the setup assistant** is the primary lever, and the human commitment
  is +37.5% of the baseline mean.
- `test-fixtures/northstar-support-full-loop.csv` contains 122 synthetic daily observations from
  2026-04-01 through 2026-07-31 for the dedicated **First-week Setup Completion** metric.
- `engine/persistence/prepare_northstar_review.py` refuses non-loopback databases, imports the
  fixture through the existing checked metric RPC, selects four populated context metrics through
  the existing checked Core Metrics RPC, and proves the workspace current-series pointer did not
  change.

## Exercised local loop

The current local report is `425d4ad4-4373-4672-b7b6-a2b40dd7645e`. The review used the real product
and checked database boundaries to save and activate it, complete all three actions, process the
queued recompute, and resolve its prediction:

1. **D1A1 Instrument the setup journey** — completed 2026-04-02.
2. **D1A2 Curate and approve setup knowledge** — completed 2026-05-15.
3. **D1A3 Build and stage the setup assistant** — primary lever, completed 2026-06-15.

The terminal readout is `CONFIRMED`: +37.0% measured versus +37.5% planned, -0.5% plan variance,
+14.7 percentage points native lift, 95% CI +14.5 to +14.9, and 75 pre / 47 post observations.

## Review surfaces

- Impact now presents the plan, measured estimate, variance, sample size, 3/3 action completion,
  the existing prediction outcome, an observed baseline/target/action timeline, and a complete
  action-to-metric trace.
- Core Metrics opens with one report target plus four populated context choices: ARR, Activation
  Rate, Churn Rate, and Support Tickets. Context selection never changes the report prediction,
  causal target, or action markers.
- Actions & Decisions shows the assigned report metric on every collapsed and expanded action,
  preserves the primary/support distinction, and retains separate guarded Claude and Codex manual
  handoff buttons.
- Browser acceptance caught a legacy-name join that rendered a report-created metric as unassigned.
  Actions and predictions now resolve dynamic metric display names through the loaded workspace
  metric records, keeping the generated UI identity consistent across action cards and handoff
  validation.

## Verification

- TypeScript and full ESLint pass.
- The complete serialized Node suite reports 554 tests: 498 passed, 56 intentional environment or
  live-model skips, and zero failures.
- The complete engine/bridge/isolation/recompute suite reports 1,217 passed. The focused Northstar
  helper suite reports 7 passed, and both review helpers compile.
- Supabase CLI 2.98.1 schema lint passes at error level for `extensions`, `private`, and `public`.
- The Next.js 16.2.11 webpack production build and request-bound dashboard manifest guard pass.
- Desktop browser acceptance verifies the locked complete report, 3/3 action cards and metric links,
  separate Claude/Codex handoff controls, terminal Impact readout and timeline, all five metric
  choices, a context chart without report action reuse, and no console warnings or errors.
- `git diff --check` passes. The local review database was intentionally not reset after acceptance
  because the founder needs the completed Northstar state for review; this pass adds no schema,
  policy, grant, RPC, trigger, or Storage change.

## Remaining human and release gates

- Complete the founder's final deep UI/workflow review.
- Run three initially unassisted partner sessions and record the existing five-part rubric.
- Apply the already-authored review/Slice 10 migrations and runtime configuration in the partner
  environment, then deploy deliberately and run authenticated migration, RLS, Storage, recompute,
  and rollback canaries.
- Authenticated MCP/API delivery, provider OAuth, trusted write tools, and durable external-agent
  attribution remain deferred until after partner review.
- Nothing in this pass was committed, pushed, deployed, or published.
