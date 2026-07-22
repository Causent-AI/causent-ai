import assert from "node:assert/strict";
import { test } from "node:test";

import { validateReportActivationInputV1 } from "./activation.ts";

const VALID_INPUT = {
  schemaVersion: 1,
  reportId: "ca5e0000-0000-0000-0000-0000000000a1",
  revisionId: "ca5e0000-0000-0000-0000-0000000000a2",
  confirmedMetricId: "ca5e0000-0000-0000-0000-0000000000a3",
  prediction: {
    direction: "POSITIVE",
    magnitudePctMean: 15,
    resolutionDate: "2026-12-15",
  },
  selectedActionSourceItemIds: ["gummy-action-1", "gummy-action-2"],
} as const;

test("activation input accepts the complete inert handoff packet", () => {
  const result = validateReportActivationInputV1(VALID_INPUT);
  assert.equal(result.success, true);
});

test("activation input requires human prediction and one to three unique actions", () => {
  const result = validateReportActivationInputV1({
    ...VALID_INPUT,
    prediction: {
      direction: "UP",
      magnitudePctMean: 0,
      resolutionDate: "2026-02-31",
    },
    selectedActionSourceItemIds: ["same", "same", "third", "fourth"],
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.errors.some((error) => error.includes("direction")));
    assert.ok(result.errors.some((error) => error.includes("positive")));
    assert.ok(result.errors.some((error) => error.includes("valid YYYY-MM-DD")));
    assert.ok(result.errors.some((error) => error.includes("one to three")));
    assert.ok(result.errors.some((error) => error.includes("duplicates")));
  }
});

test("activation input rejects missing report, revision, or metric identities", () => {
  const result = validateReportActivationInputV1({
    ...VALID_INPUT,
    reportId: "not-a-uuid",
    revisionId: null,
    confirmedMetricId: "",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.errors.filter((error) => error.includes("must be a UUID")).length, 3);
  }
});
