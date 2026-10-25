# Projects before reports

Use **Create → Project** (or **Projects → New project**) to save a goal before any report, performance metric, or observation exists. Organization owners and admins can create a project in an organization where they have an organization-wide grant. Creation atomically saves a project, workspace, setup plan, and optional milestones. Other members keep the existing workspace access rules.

**Create → Report** opens the existing report flow within the selected workspace. Reports retain their existing measurement and activation requirements; a Day 0 project does not invent a baseline or causal readout to satisfy those requirements.

The Projects page lists accessible project/workspace entries and allows switching the active workspace. The selected project's setup tracks:

- Completion milestones, which members can add, complete, or reopen.
- Planned performance metrics, which members can revise before observations exist.
- A measurement setup link to the existing Data workshop.

Planned metrics are a measurement plan, not observed metric records. Connect or import actual observations through Data when they become available. Milestone completion does not imply a measured performance improvement.

## Action handoff

Claude and Codex buttons copy the bounded selected-action brief directly. No confirmation checkbox or modal is shown. Clipboard failure exposes a selectable inline copy fallback. The prompt explicitly starts a new implementation project, asks the assistant to outline and complete tasks, includes Day 0 instrumentation, and asks for verification before the final handback. This clipboard workflow does not require or imply a connected Causent plugin.

## Release and acceptance

Apply `20261025050042_day_zero_projects.sql` before deploying this UI. It adds project setup and milestone tables with existing workspace permission helpers, an atomic invoker RPC for organization-admin creation, and no changes to existing report data or exposure settings.

Local checks cover setup validation, bounded handoff generation, database creation/retry behavior, member milestone writes, viewer restrictions, anonymous denial, cross-organization denial, and archived workspace write restrictions. The isolated SQL check uses an optional PGlite installation through `CAUSENT_TEST_PGLITE` (see the integration test's header). It applies the repository's initial schema/RLS and current archive-aware permission helper plus this migration; it is not a full migration-chain replay.

Before production promotion, verify with authenticated staging users:

1. An organization admin creates a project with only title and goal. The saved project is selected and has no observed metrics or reports.
2. Add a completion milestone, complete it, reopen it, and reload to confirm persistence.
3. Add planned metrics, then use Data to set up measurement. Planned metrics never appear as observations.
4. Create a report within the new project once the existing report measurement requirements are met. Switch to another project and verify isolation.
5. Verify an existing report's primary and supporting action copies into both Claude and Codex without a modal, with complete implementation instructions.
6. Verify viewer, member, organization-admin, and foreign-organization access. Repeat the existing fresh-unassigned and explicitly-disabled onboarding acceptance checks.

No hosted database migration, deployment, or production exposure change is performed by this PR.
