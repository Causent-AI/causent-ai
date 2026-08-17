import assert from "node:assert/strict";
import { test } from "node:test";

import {
  validateReportActivationInput,
  validateReportActivationInputV1,
  validateReportActivationInputV2,
} from "./activation.ts";

const VALID_INPUT = {
  schemaVersion: 1,
  reportId: "ca5e0000-0000-0000-0000-0000000000a1",
  revisionId: "ca5e0000-0000-0000-0000-0000000000a2",
  confirmedMetricId: "ca5e0000-0000-0000-0000-0000000000a3",
  prediction: {
    direction: "POSITIVE",
    magnitudePctMean: 15,
    resolutionDate: "2099-12-15",
  },
  selectedActionSourceItemIds: ["gummy-action-1", "gummy-action-2"],
  primaryLeverActionSourceItemId: "gummy-action-1",
} as const;

const SECONDARY_METRIC_ID = "ca5e0000-0000-0000-0000-0000000000a4";
const VALID_V2_INPUT = {
  ...VALID_INPUT,
  schemaVersion: 2,
  selectedMetricIds: [VALID_INPUT.confirmedMetricId, SECONDARY_METRIC_ID],
  actionMetricAssignments: [
    {
      actionSourceItemId: "gummy-action-1",
      metricId: VALID_INPUT.confirmedMetricId,
    },
    {
      actionSourceItemId: "gummy-action-2",
      metricId: SECONDARY_METRIC_ID,
    },
  ],
} as const;

test("activation input accepts the complete inert handoff packet", () => {
  const result = validateReportActivationInputV1(VALID_INPUT, { today: "2026-07-23" });
  assert.equal(result.success, true);
});

test("activation input requires a future resolution window", () => {
  for (const resolutionDate of ["2026-07-22", "2026-07-23"] as const) {
    const result = validateReportActivationInputV1({
      ...VALID_INPUT,
      prediction: { ...VALID_INPUT.prediction, resolutionDate },
    }, { today: "2026-07-23" });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.errors.includes("prediction.resolutionDate must be in the future"));
    }
  }
});

test("activation input requires an explicit primary lever from the selected set", () => {
  const missing = validateReportActivationInputV1({
    ...VALID_INPUT,
    primaryLeverActionSourceItemId: "",
  });
  assert.equal(missing.success, false);
  const unselected = validateReportActivationInputV1({
    ...VALID_INPUT,
    primaryLeverActionSourceItemId: "gummy-action-3",
  });
  assert.equal(unselected.success, false);
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

test("activation v2 accepts one to five metrics and a complete action mapping", () => {
  const result = validateReportActivationInputV2(VALID_V2_INPUT, { today: "2026-07-23" });
  assert.equal(result.success, true);
  assert.equal(validateReportActivationInput(VALID_V2_INPUT, { today: "2026-07-23" }).success, true);
});

test("activation v2 can defer the mutable future-date rule for checked receipt retries", () => {
  const expired = {
    ...VALID_V2_INPUT,
    prediction: { ...VALID_V2_INPUT.prediction, resolutionDate: "2026-07-22" },
  };
  assert.equal(
    validateReportActivationInputV2(expired, { today: "2026-07-23" }).success,
    false,
  );
  assert.equal(
    validateReportActivationInputV2(expired, {
      today: "2026-07-23",
      allowExpiredResolutionDate: true,
    }).success,
    true,
  );
});

test("activation v2 requires unique selected metrics including the confirmed metric", () => {
  const duplicate = validateReportActivationInputV2({
    ...VALID_V2_INPUT,
    selectedMetricIds: [SECONDARY_METRIC_ID, SECONDARY_METRIC_ID],
  });
  assert.equal(duplicate.success, false);
  if (!duplicate.success) {
    assert.ok(duplicate.errors.includes("selectedMetricIds cannot contain duplicates"));
    assert.ok(duplicate.errors.includes("selectedMetricIds must include confirmedMetricId"));
  }

  const tooMany = validateReportActivationInputV2({
    ...VALID_V2_INPUT,
    selectedMetricIds: Array.from({ length: 6 }, (_, index) =>
      `ca5e0000-0000-0000-0000-0000000001${index.toString(16).padStart(2, "0")}`
    ),
  });
  assert.equal(tooMany.success, false);
  if (!tooMany.success) {
    assert.ok(tooMany.errors.some((error) => error.includes("one to five")));
  }
});

test("activation v2 requires exactly one selected-metric assignment per action", () => {
  const missing = validateReportActivationInputV2({
    ...VALID_V2_INPUT,
    actionMetricAssignments: [VALID_V2_INPUT.actionMetricAssignments[0]],
  });
  assert.equal(missing.success, false);
  if (!missing.success) {
    assert.ok(missing.errors.some((error) => error.includes("exactly one assignment")));
    assert.ok(missing.errors.some((error) => error.includes("match the selected actions")));
  }

  const duplicate = validateReportActivationInputV2({
    ...VALID_V2_INPUT,
    actionMetricAssignments: [
      VALID_V2_INPUT.actionMetricAssignments[0],
      VALID_V2_INPUT.actionMetricAssignments[0],
    ],
  });
  assert.equal(duplicate.success, false);
  if (!duplicate.success) {
    assert.ok(duplicate.errors.some((error) => error.includes("more than once")));
  }
});

test("activation v2 binds every action to a selected metric and the primary action to the confirmed metric", () => {
  const unselectedMetric = "ca5e0000-0000-0000-0000-0000000000a5";
  const result = validateReportActivationInputV2({
    ...VALID_V2_INPUT,
    actionMetricAssignments: [
      {
        actionSourceItemId: "gummy-action-1",
        metricId: SECONDARY_METRIC_ID,
      },
      {
        actionSourceItemId: "gummy-action-2",
        metricId: unselectedMetric,
      },
    ],
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.errors.some((error) => error.includes("must use a selected metric")));
    assert.ok(result.errors.some((error) => error.includes("primary lever action")));
  }
});

test("activation v2 permits twenty-five actions but not twenty-six", () => {
  const actionIds = Array.from({ length: 25 }, (_, index) => `action-${index + 1}`);
  const accepted = validateReportActivationInputV2({
    ...VALID_V2_INPUT,
    selectedActionSourceItemIds: actionIds,
    primaryLeverActionSourceItemId: actionIds[0],
    actionMetricAssignments: actionIds.map((actionSourceItemId) => ({
      actionSourceItemId,
      metricId: VALID_V2_INPUT.confirmedMetricId,
    })),
  });
  assert.equal(accepted.success, true);

  const rejected = validateReportActivationInputV2({
    ...VALID_V2_INPUT,
    selectedActionSourceItemIds: [...actionIds, "action-26"],
    primaryLeverActionSourceItemId: actionIds[0],
    actionMetricAssignments: [...actionIds, "action-26"].map((actionSourceItemId) => ({
      actionSourceItemId,
      metricId: VALID_V2_INPUT.confirmedMetricId,
    })),
  });
  assert.equal(rejected.success, false);
  if (!rejected.success) {
    assert.ok(rejected.errors.some((error) => error.includes("twenty-five")));
  }
});
