import assert from "node:assert/strict";
import test from "node:test";

import type { Action, Observation } from "../types.ts";
import {
  buildMetricHistoryContext,
  buildReportActionMarkers,
} from "./action-visuals.ts";

function action(
  id: string,
  shippedAt: string | null,
  overrides: Partial<Action> = {},
): Action {
  return {
    id,
    pr: 0,
    title: `Action ${id}`,
    shippedAt,
    primaryMetricId: "adoption",
    impact: [],
    ...overrides,
  };
}

const series: Observation[] = [
  { date: "2026-06-01", value: 39 },
  { date: "2026-06-15", value: 55 },
  { date: "2026-06-30", value: 56 },
];

test("history context reports raw latest value and the selected observation window", () => {
  assert.deepEqual(buildMetricHistoryContext(series, series.slice(1)), {
    totalObservations: 3,
    visibleObservations: 2,
    visibleStartDate: "2026-06-15",
    visibleEndDate: "2026-06-30",
    latestDate: "2026-06-30",
    latestValue: 56,
  });
});

test("history context keeps an honest empty state", () => {
  assert.deepEqual(buildMetricHistoryContext([], []), {
    totalObservations: 0,
    visibleObservations: 0,
    visibleStartDate: null,
    visibleEndDate: null,
    latestDate: null,
    latestValue: null,
  });
});

test("report markers include exact window boundaries and identify the primary action", () => {
  const markers = buildReportActionMarkers([
    action("before", "2026-05-31"),
    action("end", "2026-06-30", { referenceLabel: "Manual action" }),
    action("primary", "2026-06-15", { displayCode: "D2A1" }),
    action("start", "2026-06-01", { pr: 42 }),
    action("planned", null),
    action("after", "2026-07-01"),
  ], "primary", series);

  assert.deepEqual(markers, [
    {
      actionId: "start",
      date: "2026-06-01",
      label: "#42",
      title: "Action start",
      isPrimary: false,
    },
    {
      actionId: "primary",
      date: "2026-06-15",
      label: "D2A1",
      title: "Action primary",
      isPrimary: true,
    },
    {
      actionId: "end",
      date: "2026-06-30",
      label: "Manual action",
      title: "Action end",
      isPrimary: false,
    },
  ]);
});

test("same-day markers retain report order without mutating the input", () => {
  const actions = [
    action("second", "2026-06-15"),
    action("first", "2026-06-15"),
  ];
  const idsBefore = actions.map(({ id }) => id);

  const markers = buildReportActionMarkers(actions, null, series);

  assert.deepEqual(markers.map(({ actionId }) => actionId), idsBefore);
  assert.deepEqual(actions.map(({ id }) => id), idsBefore);
});

test("empty windows and malformed completion dates produce no chart markers", () => {
  assert.deepEqual(
    buildReportActionMarkers([action("bad", "not-a-date")], "bad", series),
    [],
  );
  assert.deepEqual(
    buildReportActionMarkers([action("complete", "2026-06-15")], "complete", []),
    [],
  );
});
