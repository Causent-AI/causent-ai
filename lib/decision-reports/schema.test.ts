import assert from "node:assert/strict";
import { test } from "node:test";

import { GUMMY_ALPHA_GOLDEN_EXAMPLE } from "./fixtures/gummy-alpha.ts";
import {
  cloneDecisionReport,
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
