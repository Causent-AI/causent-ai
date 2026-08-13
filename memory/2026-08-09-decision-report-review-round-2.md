# Decision Report review round 2

## Why this pass exists

- The founder's second review found that onboarding still asked the user to think in Causent's
  schema before Causent had helped and that the report repeated too much instructional copy.
- The new entry is a casual business-challenge question with one short note that supporting
  evidence and resources improve the result. URL/PDF evidence remains optional.
- This is product-review work, not partner evidence. The initially unassisted partner-session gate,
  partner-environment migration/configuration, deployment, and canaries remain open.

## Locked interaction contract

- The visible report is **Decision**, **Supporting Evidence**, and **Implementation**.
- Background, Problem, and Decision remain separate provenance-bearing claims but render as one
  readable editable prose block. This avoids an irreversible attempt to split one textarea back into
  three authoritative claims.
- Supporting Evidence is an editable paragraph and may attach one chart or graph through the
  existing sanitized, private, revision-bound image path. Asset IDs and Storage paths remain
  report-specific and are never copied into a successor.
- Metric rationale is not a required report claim. The Core Metrics control follows Supporting
  Evidence, and the human commitment is labeled **Prediction**.
- A report may contain up to 25 draft actions. Activation remains one to three selected actions with
  one explicit primary manual lever; the larger draft cap does not widen canonical materialization.
- Report-level governance prompts leave the editor. Existing snapshot fields remain readable for
  historical compatibility; action-level governance is a separate execution concern.
- Draft edits use a debounced, serialized autosave queue. Asset mutations and activation must flush
  the exact latest revision. Exact retries are duplicate-free, stale requests stop without silent
  rebasing, and active reports remain immutable.
- Partial activation choices autosave in the existing revision JSON and hydrate after refresh. They
  remain non-canonical until the checked activation RPC; missing metric, action, primary lever,
  magnitude, or future date stays highlighted in the form.

## Review follow-up: on-demand visuals and manual agent launchers

- Actions provides an on-demand History chart from existing current-report metric observations and
  action timing rather than another persistent summary card. It creates no observations or evidence.
- Impact provides a plan-versus-outcome chart from existing current-report activation, prediction,
  and evidence data. It distinguishes planned, gathering, preliminary descriptive, and measured
  states without manufacturing a causal result.
- Claude and Codex are distinct UI triggers for the same bounded manual clipboard handoff dialog.
  Neither trigger authenticates with a provider, sends context automatically, or creates a connector.
- This follow-up is display and composition work only. It adds no migration, schema/table change,
  Storage data, server write, durable handback, or graph evidence.
- Authenticated MCP/API delivery, provider OAuth, automatic context delivery, trusted mutation tools,
  and durable attribution remain deferred until after partner review.

## Founder follow-up: one document editor and shared header

- Decision, Supporting Evidence, and the Implementation plan summary now sit inside one labeled
  document-editor canvas. Narrative blocks expand to their content and no longer expose resize
  handles or internal scrollbars.
- The presentation did not flatten `DecisionReportV1`: every claim keeps its stable ID, provenance,
  missing-field target, validated edit command, and existing serialized autosave behavior. Charts,
  private assets, metric selection, actions, and activation remain typed embedded controls.
- Onboarding reuses the dashboard `GlobalHeader`. Its 56px header and logo geometry now match at
  desktop and narrow widths; the New Project label collapses at the mobile breakpoint, and the
  Next.js development badge is disabled because it was covering the logo during local review.

## Database readiness correction

Review round 1 added
`20260810005135_make_decision_report_evidence_optional.sql`, which made proof factors optional but
still required `supportingEvidence.metricMechanism`. Review round 2 adds the later forward migration
`20260810044832_remove_metric_mechanism_from_report_readiness.sql` instead of rewriting the earlier
file. The private immutable predicate now requires only:

1. Background
2. Problem
3. Decision
4. Action Plan summary
5. At least one titled action

Supporting evidence and metric rationale may be missing. The replacement changes no table, RLS,
grant, Storage, canonical-row, report-series, or active-report contract. Focused persistence
integration coverage accepts a provenance-valid report missing both optional areas and separately
rejects each missing required field.

## Verification and release boundary

- Follow-up validation passes: 19 focused visualization/handoff tests and the complete 540-test
  library run pass with 56 intentional environment/live-model skips; TypeScript, full ESLint,
  `git diff --check`, the Next.js 16.2.11 webpack production build, and the request-bound dashboard
  manifest guard pass.
- Desktop and 390px browser acceptance verifies the collapsed and expanded Adoption Rate History
  views, Trend/Momentum controls, the honest unresolved Outcome state, and distinct Claude/Codex
  egress-gated dialogs. Native controls expose focus states and the browser console has zero warnings
  or errors. A live pass caught and fixed the database-UUID/UI-metric-ID join by selecting the
  already-isolated current-report metric.
- The local review server redirects `/onboarding` to `?flow=decision-report`, serves the new Actions
  surface with HTTP 200, and uses the existing local Supabase configuration only in memory. No
  credential file was created.

- The migration was generated through the installed Supabase CLI after inspecting
  `supabase migration new --help`.
- A clean local reset applies both Review migrations and schema error lint passes. The complete
  serialized Node/Supabase/RLS/Storage run reports 527 total: 508 passed, 19 intentional live-model
  skips, and zero failures; the focused adversarial RLS run reports 48/48 passed; and the complete
  engine/bridge/isolation/recompute suite reports 1,210/1,210 passed.
- TypeScript, full ESLint, the pinned Node 22 Next.js 16.2.11 webpack build, the post-build
  request-bound dashboard manifest guard, and `git diff --check` pass.
- Browser acceptance at desktop and 390px starts from the casual challenge prompt, loads Gummy
  Alpha, proves required-title/action highlighting plus report and activation-draft autosave across
  refresh, activates one report, follows its exact link, and then activates a successor against the
  isolated Adoption Rate fixture. Completion plus the loopback worker renders a confident +14.7pp
  current-report readout across Impact. The clean pass has zero console errors and zero failed requests.
- A concurrently running development server can corrupt webpack's generated cache and surface a
  misleading `WasmHash` failure. Stop that exact server and rebuild from a clean `.next` under the
  pinned Node runtime. The Node `module.register()` deprecation warning seen in development remains
  non-blocking and is not the build failure.
- No migration has been applied to the partner environment, and nothing was committed, pushed,
  deployed, or published by this implementation run. Founder Review #2, partner evidence, partner
  environment configuration, and authenticated canaries remain human/operator gates.
