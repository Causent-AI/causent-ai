import assert from "node:assert/strict";
import { test } from "node:test";

import { GUMMY_ALPHA_GOLDEN_EXAMPLE } from "./fixtures/gummy-alpha.ts";
import { NORTHSTAR_SUPPORT_GOLDEN_EXAMPLE } from "./fixtures/northstar-support.ts";
import {
  cloneDecisionReport,
  MAX_DECISION_REPORT_ACTIONS,
  upgradeLegacyDecisionReportForEditing,
  validateDecisionReport,
  validateMetricProjection,
} from "./schema.ts";

test("Gummy Alpha is a valid versioned Decision Report fixture", () => {
  const result = validateDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  assert.equal(result.success, true, result.success ? undefined : result.errors.join("\n"));
});

test("Northstar Support is a complete activation-ready Decision Report fixture", () => {
  const example = NORTHSTAR_SUPPORT_GOLDEN_EXAMPLE;
  const result = validateDecisionReport(example.report);
  assert.equal(result.success, true, result.success ? undefined : result.errors.join("\n"));
  assert.equal(validateMetricProjection(example.metricProjection).success, true);
  assert.equal(example.report.implementation.actions.length, 3);
  assert.ok(
    example.report.implementation.actions.every(
      (action) => action.owner?.text.trim() && action.estimatedTime && action.estimatedCost,
    ),
  );
  assert.deepEqual(
    example.report.activationDraft?.selectedActionSourceItemIds,
    example.report.implementation.actions.map((action) => action.sourceItemId),
  );
  assert.ok(example.report.activationDraft?.primaryLeverActionSourceItemId);
  assert.equal(example.report.activationDraft?.prediction.magnitudePctMean, 37.5);
  assert.equal(example.metricProjection.metricName, "First-week Setup Completion");
  assert.equal(example.metricProjection.evidenceState, "prompt_supplied");
});

test("sourced claims require a source chunk", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  report.decision.decision[0].sourceChunkIds = [];

  const result = validateDecisionReport(report);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.errors.some((error) => error.includes("has no source chunk")));
  }
});

test("missing claims cannot silently contain text", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  report.implementation.stakeholders[0].text = "Product lead";

  const result = validateDecisionReport(report);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.errors.some((error) => error.includes("is missing but contains text")));
  }
});

test("action plans allow 25 draft actions but reject a 26th", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const template = structuredClone(report.implementation.actions[0]);
  while (report.implementation.actions.length < MAX_DECISION_REPORT_ACTIONS) {
    const index = report.implementation.actions.length + 1;
    report.implementation.actions.push({
      ...structuredClone(template),
      sourceItemId: `action-${index}`,
      summary: [{
        ...structuredClone(template.summary[0]),
        id: `action-${index}-summary`,
      }],
      owner: null,
    });
  }

  assert.equal(validateDecisionReport(report).success, true);

  report.implementation.actions.push({
    ...structuredClone(template),
    sourceItemId: "action-26",
    summary: [{
      ...structuredClone(template.summary[0]),
      id: "action-26-summary",
    }],
    owner: null,
  });

  const result = validateDecisionReport(report);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.errors.some((error) => error.includes("cannot exceed 25")));
  }
});

test("action execution metadata is bounded and validated", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  report.implementation.actions[0].priority = 3;
  report.implementation.actions[0].tags = ["Measurement", "Experiment"];
  report.implementation.actions[0].skills = ["Analytics engineering"];
  report.implementation.actions[0].estimatedTime = "2–3 days";
  report.implementation.actions[0].estimatedCost = "Internal team";
  assert.equal(validateDecisionReport(report).success, true);

  report.implementation.actions[0].tags = Array.from({ length: 6 }, (_, index) => `tag-${index}`);
  const invalid = validateDecisionReport(report);
  assert.equal(invalid.success, false);
  if (!invalid.success) {
    assert.ok(invalid.errors.some((error) => error.includes("tags")));
  }
});

test("activation draft intent is optional, bounded, and tied to report actions", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const actionId = report.implementation.actions[0].sourceItemId;
  report.activationDraft = {
    confirmedMetricId: "ca5e0000-0000-0000-0000-000000000073",
    selectedActionSourceItemIds: [actionId],
    primaryLeverActionSourceItemId: actionId,
    prediction: {
      direction: "NEGATIVE",
      magnitudePctMean: 12.5,
      resolutionDate: "2099-12-15",
    },
  };
  assert.equal(validateDecisionReport(report).success, true);

  report.activationDraft.selectedActionSourceItemIds = ["forged-action"];
  const forgedAction = validateDecisionReport(report);
  assert.equal(forgedAction.success, false);
  if (!forgedAction.success) {
    assert.ok(
      forgedAction.errors.some((error) =>
        error.includes("unique report action IDs"),
      ),
    );
  }

  report.activationDraft.selectedActionSourceItemIds = [actionId];
  report.activationDraft.primaryLeverActionSourceItemId = actionId;
  report.activationDraft.confirmedMetricId = "not-a-metric";
  report.activationDraft.prediction.resolutionDate = "2099-02-31";
  const invalidFields = validateDecisionReport(report);
  assert.equal(invalidFields.success, false);
  if (!invalidFields.success) {
    assert.ok(invalidFields.errors.some((error) => error.includes("must be null or a UUID")));
    assert.ok(invalidFields.errors.some((error) => error.includes("valid YYYY-MM-DD date")));
  }
});

test("supporting evidence cannot exceed three proof claims", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  report.supportingEvidence.factors.push(structuredClone(report.supportingEvidence.factors[0]));

  const result = validateDecisionReport(report);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.errors.some((error) => error.includes("supportingEvidence.factors cannot exceed 3")));
  }
});

test("sanitized source metadata persists the chunk-to-source mapping", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  assert.equal(validateDecisionReport(report).success, true);

  report.sourceSummaries![0].chunks[0].chunkId = "unrelated-chunk";
  const forged = validateDecisionReport(report);
  assert.equal(forged.success, false);
  if (!forged.success) {
    assert.ok(
      forged.errors.some((error) =>
        error.includes("sourced claims must reference a persisted source chunk"),
      ),
    );
  }
});

test("new reports cannot omit or forge durable source provenance", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  delete report.sourceSummaries;
  const missing = validateDecisionReport(report);
  assert.equal(missing.success, false);
  if (!missing.success) {
    assert.ok(missing.errors.some((error) => error.includes("sourceSummaries is required")));
  }

  const forged = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  forged.sourceSummaries![0].chunks[0].contentSha256 = "not-a-digest";
  const invalidDigest = validateDecisionReport(forged);
  assert.equal(invalidDigest.success, false);
});

test("legacy v1 snapshots remain readable without claiming v2 provenance", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  report.schemaVersion = 1;
  delete report.sourceSummaries;
  assert.equal(validateDecisionReport(report).success, true);

  const upgraded = upgradeLegacyDecisionReportForEditing(report);
  assert.equal(upgraded.schemaVersion, 2);
  assert.deepEqual(upgraded.sourceSummaries, []);
  assert.equal(upgraded.decision.decision[0].status, "user_confirmed");
  assert.deepEqual(upgraded.decision.decision[0].sourceChunkIds, []);
  assert.equal(validateDecisionReport(upgraded).success, true);
});

test("metric projections validate bounded percentages and evidence state", () => {
  const valid = validateMetricProjection(GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection);
  assert.equal(valid.success, true);

  const invalid = validateMetricProjection({
    ...GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    predictedPct: 140,
    evidenceState: "observed",
  });
  assert.equal(invalid.success, false);
  if (!invalid.success) {
    assert.ok(invalid.errors.some((error) => error.includes("predictedPct")));
    assert.ok(invalid.errors.some((error) => error.includes("evidenceState")));
  }
});
