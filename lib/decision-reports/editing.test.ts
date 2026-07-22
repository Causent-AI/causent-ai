import assert from "node:assert/strict";
import { test } from "node:test";

import { GUMMY_ALPHA_GOLDEN_EXAMPLE } from "./fixtures/gummy-alpha.ts";
import { createSafeFallbackReport } from "./generation-contract.ts";
import {
  applyReportEditCommand,
  createGapAnswerCommand,
  scanDecisionReportGaps,
} from "./editing.ts";
import {
  cloneDecisionReport,
  validateDecisionReport,
} from "./schema.ts";

function fallbackReport() {
  let index = 0;
  return createSafeFallbackReport("We should launch a new product onboarding flow.", {
    idFactory: () => `test-${index++}`,
  }).report;
}

test("gap scanner uses the stable required-field order", () => {
  const report = fallbackReport();

  assert.deepEqual(
    scanDecisionReportGaps(report).map((gap) => gap.kind),
    [
      "decision",
      "problem",
      "proof",
      "metric_mechanism",
      "action_plan_summary",
      "action",
    ],
  );
});

test("optional missing fields do not block a complete report", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  assert.equal(report.implementation.customers[0].status, "missing");
  assert.equal(report.implementation.stakeholders[0].status, "missing");
  assert.equal(report.implementation.governance.dataClassification, null);
  assert.deepEqual(scanDecisionReportGaps(report), []);
});

test("claim edits confirm user text, clear provenance, and preserve IDs", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const originalIds = structuredClone(report).decision.decision.map((claim) => claim.id);
  const result = applyReportEditCommand(report, {
    type: "replace_claim_text",
    claimId: "decision-primary",
    text: "Launch the assistant for a limited partner cohort.",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.report.decision.decision[0].status, "user_confirmed");
  assert.deepEqual(result.report.decision.decision[0].sourceChunkIds, []);
  assert.deepEqual(
    result.report.decision.decision.map((claim) => claim.id),
    originalIds,
  );
  assert.equal(validateDecisionReport(result.report).success, true);
});

test("action commands preserve action and nested claim IDs", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const action = report.implementation.actions[0];
  const summaryId = action.summary[0].id;

  const summaryResult = applyReportEditCommand(report, {
    type: "edit_action_summary",
    sourceItemId: action.sourceItemId,
    text: "Instrument starts and completions before launch.",
  });
  assert.equal(summaryResult.ok, true);
  if (!summaryResult.ok) return;
  assert.equal(summaryResult.report.implementation.actions[0].sourceItemId, action.sourceItemId);
  assert.equal(summaryResult.report.implementation.actions[0].summary[0].id, summaryId);
  assert.equal(summaryResult.report.implementation.actions[0].summary[0].status, "user_confirmed");

  const ownerResult = applyReportEditCommand(summaryResult.report, {
    type: "edit_action_owner",
    sourceItemId: action.sourceItemId,
    text: "Growth engineering",
  });
  assert.equal(ownerResult.ok, true);
  if (!ownerResult.ok) return;
  const ownerId = ownerResult.report.implementation.actions[0].owner?.id;

  const revisedOwnerResult = applyReportEditCommand(ownerResult.report, {
    type: "edit_action_owner",
    sourceItemId: action.sourceItemId,
    text: "Product engineering",
  });
  assert.equal(revisedOwnerResult.ok, true);
  if (!revisedOwnerResult.ok) return;
  assert.equal(revisedOwnerResult.report.implementation.actions[0].owner?.id, ownerId);
});

test("action titles and data classification use the typed edit path", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const actionId = report.implementation.actions[0].sourceItemId;
  const titled = applyReportEditCommand(report, {
    type: "edit_action_title",
    sourceItemId: actionId,
    title: "Measure the assisted mixer funnel",
  });
  assert.equal(titled.ok, true);
  if (!titled.ok) return;

  const classified = applyReportEditCommand(titled.report, {
    type: "set_data_classification",
    value: "organization",
  });
  assert.equal(classified.ok, true);
  if (!classified.ok) return;
  assert.equal(
    classified.report.implementation.actions[0].title,
    "Measure the assisted mixer funnel",
  );
  assert.equal(
    classified.report.implementation.governance.dataClassification,
    "organization",
  );
  assert.equal(validateDecisionReport(classified.report).success, true);
});

test("invalid commands are rejected without mutating the input", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const before = structuredClone(report);
  const unknownClaim = applyReportEditCommand(report, {
    type: "replace_claim_text",
    claimId: "unknown",
    text: "New text",
  });
  const blankTitle = applyReportEditCommand(report, {
    type: "edit_action_title",
    sourceItemId: report.implementation.actions[0].sourceItemId,
    title: "  ",
  });

  assert.equal(unknownClaim.ok, false);
  assert.equal(blankTitle.ok, false);
  assert.deepEqual(report, before);
});

test("adding actions respects the three-action ceiling and creates stable IDs", () => {
  const report = fallbackReport();
  const added = applyReportEditCommand(report, {
    type: "add_action",
    sourceItemId: "user-action-1",
    title: "Instrument the onboarding funnel",
    summary: "",
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.report.implementation.actions[0].sourceItemId, "user-action-1");
  assert.equal(added.report.implementation.actions[0].summary[0].id, "user-action-1-summary");
  assert.equal(added.report.implementation.actions[0].summary[0].status, "missing");

  const capped = applyReportEditCommand(GUMMY_ALPHA_GOLDEN_EXAMPLE.report, {
    type: "add_action",
    sourceItemId: "user-action-4",
    title: "A fourth action",
    summary: "Not allowed",
  });
  assert.equal(capped.ok, false);
});

test("focused answers and direct edits produce the same validated report", () => {
  const report = fallbackReport();
  const gap = scanDecisionReportGaps(report)[0];
  const answer = "Launch the new onboarding flow for partner teams.";
  const focusedCommand = createGapAnswerCommand(gap, answer);
  assert.equal(focusedCommand.ok, true);
  if (!focusedCommand.ok || !gap.claimId) return;

  const focused = applyReportEditCommand(report, focusedCommand.command);
  const direct = applyReportEditCommand(report, {
    type: "replace_claim_text",
    claimId: gap.claimId,
    text: answer,
  });

  assert.equal(focused.ok, true);
  assert.equal(direct.ok, true);
  if (!focused.ok || !direct.ok) return;
  assert.deepEqual(focused.report, direct.report);
  assert.equal(validateDecisionReport(focused.report).success, true);
});

test("answering all fallback gaps transitions the report to ready", () => {
  let report = fallbackReport();
  const answers = [
    "Launch a new onboarding flow.",
    "New teams do not know where to begin.",
    "Support requests mention setup confusion.",
    "Clearer setup should increase onboarding completion.",
    "Instrument, build, and test the new flow.",
    "Instrument onboarding starts and completions.",
  ];

  for (const answer of answers) {
    const gap = scanDecisionReportGaps(report)[0];
    const command = createGapAnswerCommand(
      gap,
      answer,
      gap.kind === "action" ? "user-action-ready" : undefined,
    );
    assert.equal(command.ok, true);
    if (!command.ok) return;
    const edited = applyReportEditCommand(report, command.command);
    assert.equal(edited.ok, true);
    if (!edited.ok) return;
    report = edited.report;
  }

  assert.deepEqual(scanDecisionReportGaps(report), []);
  assert.equal(validateDecisionReport(report).success, true);
});
