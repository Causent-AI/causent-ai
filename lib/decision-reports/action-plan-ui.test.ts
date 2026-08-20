import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatMetricReadinessDetail,
  isSupportingActionForMonitoring,
  resolveDecisionReportActionSelection,
} from "./action-plan-ui.ts";

test("metric readiness keeps the latest native value and percent scale compact", () => {
  assert.equal(
    formatMetricReadinessDetail({
      unit: "percent",
      format: "percent",
      percentScale: "ratio",
      lastObservationDate: "2026-08-15",
      lastObservationValue: 0.42,
      preHistoryObservationCount: 90,
      preHistoryDays: 90,
      earliestConfidentReviewDate: "2026-09-30",
    }),
    "percent (ratio scale) · Last 42.0% on 2026-08-15 · 90 obs / 90d · Review 2026-09-30",
  );

  assert.equal(
    formatMetricReadinessDetail({
      unit: "percent",
      format: "percent",
      percentScale: "points",
      lastObservationDate: "2026-08-15",
      lastObservationValue: 42,
      preHistoryObservationCount: 90,
      preHistoryDays: 90,
      earliestConfidentReviewDate: "2026-09-30",
    }),
    "percent (points scale) · Last 42.0% on 2026-08-15 · 90 obs / 90d · Review 2026-09-30",
  );
});

test("metric readiness remains honest when no observation exists", () => {
  assert.equal(
    formatMetricReadinessDetail({
      unit: "count",
      format: "count",
      percentScale: "points",
      lastObservationDate: null,
      lastObservationValue: null,
      preHistoryObservationCount: 0,
      preHistoryDays: 0,
      earliestConfidentReviewDate: "2026-11-14",
    }),
    "count · No observations · 0 obs / 0d · Review 2026-11-14",
  );
});

test("monitoring context belongs only to supporting actions", () => {
  assert.equal(isSupportingActionForMonitoring("support", "primary"), true);
  assert.equal(isSupportingActionForMonitoring("primary", "primary"), false);
});

test("an active report uses canonical source-item bindings instead of action UUIDs", () => {
  assert.deepEqual(
    resolveDecisionReportActionSelection({
      active: true,
      reportActionSourceItemIds: ["report-action-1", "report-action-2"],
      draftSelectedActionSourceItemIds: [],
      draftPrimaryActionSourceItemId: null,
      activationSelectedActionSourceItemIds: ["report-action-1", "report-action-2"],
      activationPrimaryActionSourceItemId: "report-action-2",
    }),
    {
      selectedActionIds: ["report-action-1", "report-action-2"],
      primaryActionId: "report-action-2",
    },
  );
});

test("a legacy active report does not infer a primary action when the audit has none", () => {
  assert.deepEqual(
    resolveDecisionReportActionSelection({
      active: true,
      reportActionSourceItemIds: ["report-action-1", "report-action-2"],
      draftSelectedActionSourceItemIds: ["report-action-1"],
      draftPrimaryActionSourceItemId: "report-action-1",
      activationSelectedActionSourceItemIds: ["report-action-1", "report-action-2"],
      activationPrimaryActionSourceItemId: null,
    }),
    {
      selectedActionIds: ["report-action-1", "report-action-2"],
      primaryActionId: "",
    },
  );
});

test("a new report includes every suggested action and keeps its draft primary", () => {
  assert.deepEqual(
    resolveDecisionReportActionSelection({
      active: false,
      reportActionSourceItemIds: ["report-action-1", "report-action-2"],
      draftSelectedActionSourceItemIds: ["report-action-2"],
      draftPrimaryActionSourceItemId: "report-action-2",
      activationSelectedActionSourceItemIds: [],
      activationPrimaryActionSourceItemId: null,
    }),
    {
      selectedActionIds: ["report-action-1", "report-action-2"],
      primaryActionId: "report-action-2",
    },
  );
});
