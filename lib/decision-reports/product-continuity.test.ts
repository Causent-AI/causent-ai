import assert from "node:assert/strict";
import { test } from "node:test";

import {
  inferMetricPercentScale,
  reportExecutionState,
  reportLifecyclePresentation,
  latestMetricObservationAt,
  latestMetricValueAt,
  signedCommitmentLabel,
} from "./product-continuity.ts";

test("percent scale follows the connected metric's stored values", () => {
  assert.equal(
    inferMetricPercentScale("percent", [{ value: 0.4 }, { value: 0.55 }]),
    "ratio",
  );
  assert.equal(
    inferMetricPercentScale("percent", [{ value: 40 }, { value: 55 }]),
    "points",
  );
  assert.equal(inferMetricPercentScale("count", [{ value: 0.4 }]), "points");
});

test("the report lifecycle advances without adding a second activation action", () => {
  assert.deepEqual(
    reportLifecyclePresentation({
      active: false,
      requiredFieldCount: 2,
      commitmentReady: false,
      actionCount: 3,
    }),
    {
      stage: "finish_report",
      label: "Finish report",
      title: "2 required fields remaining",
      detail: "",
      actionLabel: "Next field",
    },
  );

  assert.deepEqual(
    reportLifecyclePresentation({
      active: false,
      requiredFieldCount: 0,
      commitmentReady: false,
      actionCount: 3,
    }),
    {
      stage: "set_commitment",
      label: "Set commitment",
      title: "Complete the outcome commitment",
      detail: "3 actions included",
      actionLabel: "Next commitment",
    },
  );

  assert.deepEqual(
    reportLifecyclePresentation({
      active: false,
      requiredFieldCount: 0,
      commitmentReady: true,
      actionCount: 3,
    }),
    {
      stage: "start_action",
      label: "Start an action",
      title: "3 actions ready",
      detail: "Starting one activates all 3.",
      actionLabel: "Go to Start",
    },
  );
});

test("the native commitment baseline stops at the commitment date", () => {
  assert.equal(
    latestMetricValueAt([
      { date: "2026-08-01", value: 40 },
      { date: "2026-08-02", value: 42 },
      { date: "2026-08-03", value: 44 },
    ], "2026-08-02"),
    42,
  );
  assert.equal(
    latestMetricValueAt([{ date: "2026-08-03", value: 44 }], "2026-08-02"),
    null,
  );
  assert.deepEqual(
    latestMetricObservationAt([
      { date: "2026-08-01", value: 40 },
      { date: "2026-08-02", value: 42 },
    ], "2026-08-02"),
    { date: "2026-08-02", value: 42 },
  );
});

test("the lifecycle presents an active report as immutable", () => {
  assert.deepEqual(
    reportLifecyclePresentation({
      active: true,
      requiredFieldCount: 0,
      commitmentReady: true,
      actionCount: 1,
    }),
    {
      stage: "active",
      label: "Plan active",
      title: "1 action activated",
      detail: "Execution and measurement are underway.",
      actionLabel: null,
    },
  );
});

test("the execution header keeps commitment direction and plan state explicit", () => {
  assert.equal(signedCommitmentLabel("POSITIVE", 12), "+12% of mean");
  assert.equal(signedCommitmentLabel("NEGATIVE", 7.25), "−7.3% of mean");
  assert.equal(
    reportExecutionState({
      actionCount: 3,
      completedActionCount: 0,
      verdictLabel: null,
    }),
    "Active",
  );
  assert.equal(
    reportExecutionState({
      actionCount: 3,
      completedActionCount: 2,
      verdictLabel: null,
    }),
    "In progress",
  );
  assert.equal(
    reportExecutionState({
      actionCount: 3,
      completedActionCount: 3,
      verdictLabel: null,
    }),
    "Measuring",
  );
  assert.equal(
    reportExecutionState({
      actionCount: 3,
      completedActionCount: 3,
      verdictLabel: "Confirmed",
    }),
    "Confirmed",
  );
});
