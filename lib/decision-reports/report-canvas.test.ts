import assert from "node:assert/strict";
import { test } from "node:test";

import { GUMMY_ALPHA_GOLDEN_EXAMPLE } from "./fixtures/gummy-alpha.ts";
import {
  composeDecisionReportCanvas,
  composeDecisionReportCanvases,
  decisionReportCanvasClaimIds,
  decisionReportCanvasIdentity,
  splitDecisionReportCanvas,
} from "./report-canvas.ts";
import {
  cloneDecisionReport,
  portableRichTextFromPlainText,
} from "./schema.ts";

test("composes the report into the two stable editor canvases", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const canvases = composeDecisionReportCanvases(report);

  assert.deepEqual(
    canvases.decision.sections.map((section) => section.kind),
    ["background", "problem", "decision", "evidence"],
  );
  assert.deepEqual(
    canvases.action_plan.sections.map((section) => section.kind),
    ["action_plan_summary", "core_metrics", "action", "action", "action"],
  );
  assert.equal(canvases.decision.sections[3].optional, true);
  assert.equal(canvases.action_plan.sections[1].claims.length, 0);
  assert.deepEqual(
    canvases.action_plan.sections.slice(2).map((section) =>
      section.actionSourceItemId),
    report.implementation.actions.map((action) => action.sourceItemId),
  );
  assert.deepEqual(
    canvases.decision.sections[0].claims[0].document,
    portableRichTextFromPlainText(report.decision.background[0].text),
  );
});

test("canvas structural identity ignores content and display-title edits", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const original = composeDecisionReportCanvas(report, "action_plan");
  const originalIdentity = decisionReportCanvasIdentity(original);

  report.implementation.actionPlanSummary[0].text = "A revised plan.";
  report.implementation.actions[0].title = "A revised action title";
  assert.equal(
    decisionReportCanvasIdentity(
      composeDecisionReportCanvas(report, "action_plan"),
    ),
    originalIdentity,
  );

  report.implementation.actions.push({
    sourceItemId: "new-action",
    title: "New action",
    summary: [{
      id: "new-action-summary",
      text: "Do the new work.",
      status: "user_confirmed",
      sourceChunkIds: [],
    }],
    owner: null,
  });
  assert.notEqual(
    decisionReportCanvasIdentity(
      composeDecisionReportCanvas(report, "action_plan"),
    ),
    originalIdentity,
  );

  const optionalityChanged = structuredClone(original);
  optionalityChanged.sections[0].optional = true;
  assert.notEqual(
    decisionReportCanvasIdentity(optionalityChanged),
    originalIdentity,
  );
});

test("split returns validated claim documents and rejects forged identities", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const canvas = composeDecisionReportCanvas(report, "decision");
  const split = splitDecisionReportCanvas(canvas);
  assert.equal(split.ok, true, split.ok ? undefined : split.error);
  if (!split.ok) return;
  assert.deepEqual(
    split.documents.map((entry) => entry.claimId),
    decisionReportCanvasClaimIds(canvas),
  );

  const duplicated = structuredClone(canvas);
  duplicated.sections[1].claims[0].claimId =
    duplicated.sections[0].claims[0].claimId;
  const duplicateResult = splitDecisionReportCanvas(duplicated);
  assert.deepEqual(duplicateResult, {
    ok: false,
    error: "Canvas claim identities must be unique.",
  });

  const invalid = structuredClone(canvas);
  invalid.sections[0].claims[0].document = {
    type: "doc",
    content: [],
  };
  const invalidResult = splitDecisionReportCanvas(invalid);
  assert.equal(invalidResult.ok, false);
  if (!invalidResult.ok) assert.match(invalidResult.error, /is invalid/);

  const forgedStructure = structuredClone(canvas);
  forgedStructure.sections[0].kind = "problem";
  const forgedStructureResult = splitDecisionReportCanvas(forgedStructure);
  assert.deepEqual(forgedStructureResult, {
    ok: false,
    error: "Decision canvas structure is invalid.",
  });
});

test("action-plan split retains typed slots while rejecting forged action identities", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const canvas = composeDecisionReportCanvas(report, "action_plan");
  const split = splitDecisionReportCanvas(canvas);
  assert.equal(split.ok, true, split.ok ? undefined : split.error);

  const metricsWithDocument = structuredClone(canvas);
  metricsWithDocument.sections[1].claims.push({
    claimId: "forged-metric-claim",
    document: portableRichTextFromPlainText("Metrics remain typed controls."),
  });
  const forgedMetrics = splitDecisionReportCanvas(metricsWithDocument);
  assert.deepEqual(forgedMetrics, {
    ok: false,
    error: "Action-plan canvas structure is invalid.",
  });

  const forgedAction = structuredClone(canvas);
  forgedAction.sections[2].actionSourceItemId = "different-action";
  const forgedActionResult = splitDecisionReportCanvas(forgedAction);
  assert.deepEqual(forgedActionResult, {
    ok: false,
    error: "Action-plan canvas structure is invalid.",
  });
});

test("an empty evidence collection keeps the optional canvas section", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  report.supportingEvidence.factors = [];

  const canvas = composeDecisionReportCanvas(report, "decision");
  const evidence = canvas.sections.find((section) => section.kind === "evidence");
  assert.ok(evidence);
  assert.equal(evidence.optional, true);
  assert.deepEqual(evidence.claims, []);
});
