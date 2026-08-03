import assert from "node:assert/strict";
import { test } from "node:test";

import { GUMMY_ALPHA_GOLDEN_EXAMPLE } from "./fixtures/gummy-alpha.ts";
import {
  cloneDecisionReport,
  upgradeLegacyDecisionReportForEditing,
  validateDecisionReport,
  validateMetricProjection,
} from "./schema.ts";

test("Gummy Alpha is a valid versioned Decision Report fixture", () => {
  const result = validateDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  assert.equal(result.success, true, result.success ? undefined : result.errors.join("\n"));
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

test("action plans cannot exceed three actions", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  report.implementation.actions.push(structuredClone(report.implementation.actions[0]));

  const result = validateDecisionReport(report);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.errors.some((error) => error.includes("cannot exceed 3")));
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
