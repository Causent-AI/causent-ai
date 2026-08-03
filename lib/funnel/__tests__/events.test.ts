// Unit gate for the funnel metrics fold (C2/#15 DoD, C5/#18). Pure — no DB.
// Proves the four DoD metrics compute correctly from raw event rows:
// time-to-first-type (<30s target), Step-4 commit rate, step drop-off, and the
// resolution-return rate.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TIME_TO_FIRST_TYPE_TARGET_MS,
  computeDecisionReportFunnelMetrics,
  computeFunnelMetrics,
  median,
  type FunnelEventRow,
} from "../events.ts";

test("median handles empty, odd, and even counts", () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5); // mean of the two middles
});

test("empty event set yields null rates, zero counts", () => {
  const m = computeFunnelMetrics([]);
  assert.equal(m.landedRuns, 0);
  assert.equal(m.committedRuns, 0);
  assert.equal(m.commitRate, null);
  assert.equal(m.timeToFirstType.count, 0);
  assert.equal(m.timeToFirstType.medianMs, null);
  assert.equal(m.timeToFirstType.underTargetRate, null);
  assert.equal(m.resolutionReturnRate, null);
  assert.deepEqual(m.dropOffByStep, { paste: 0, card: 0, commit: 0, done: 0 });
});

test("commit rate = committed runs / landed runs, deduped per session", () => {
  const rows: FunnelEventRow[] = [
    // run A: lands, views two steps, commits (duplicate COMMITTED must not double-count)
    { sessionKey: "A", eventType: "LANDED", step: "paste", msSinceStart: null },
    { sessionKey: "A", eventType: "STEP_VIEW", step: "paste", msSinceStart: null },
    { sessionKey: "A", eventType: "STEP_VIEW", step: "card", msSinceStart: null },
    { sessionKey: "A", eventType: "COMMITTED", step: "done", msSinceStart: null },
    { sessionKey: "A", eventType: "COMMITTED", step: "done", msSinceStart: null },
    // run B: lands, drops at card (no commit)
    { sessionKey: "B", eventType: "LANDED", step: "paste", msSinceStart: null },
    { sessionKey: "B", eventType: "STEP_VIEW", step: "paste", msSinceStart: null },
    { sessionKey: "B", eventType: "STEP_VIEW", step: "card", msSinceStart: null },
  ];
  const m = computeFunnelMetrics(rows);
  assert.equal(m.landedRuns, 2);
  assert.equal(m.committedRuns, 1);
  assert.equal(m.commitRate, 0.5);
  // Drop-off: both viewed paste + card, only A reached done via COMMITTED (not a STEP_VIEW at done here).
  assert.equal(m.dropOffByStep.paste, 2);
  assert.equal(m.dropOffByStep.card, 2);
  assert.equal(m.dropOffByStep.commit, 0);
});

test("time-to-first-type: median + under-30s-target rate", () => {
  const under = TIME_TO_FIRST_TYPE_TARGET_MS - 1;
  const over = TIME_TO_FIRST_TYPE_TARGET_MS + 5_000;
  const rows: FunnelEventRow[] = [
    { sessionKey: "A", eventType: "FIRST_TYPE", step: "paste", msSinceStart: 4_000 },
    { sessionKey: "B", eventType: "FIRST_TYPE", step: "paste", msSinceStart: under },
    { sessionKey: "C", eventType: "FIRST_TYPE", step: "paste", msSinceStart: over },
    // a null ms sample is ignored (not counted)
    { sessionKey: "D", eventType: "FIRST_TYPE", step: "paste", msSinceStart: null },
  ];
  const m = computeFunnelMetrics(rows);
  assert.equal(m.timeToFirstType.count, 3);
  assert.equal(m.timeToFirstType.medianMs, under); // middle of [4000, under, over]
  // 2 of 3 under target.
  assert.ok(Math.abs((m.timeToFirstType.underTargetRate ?? 0) - 2 / 3) < 1e-9);
});

test("resolution-return rate = committed runs that came back to a scorecard", () => {
  const rows: FunnelEventRow[] = [
    { sessionKey: "A", eventType: "COMMITTED", step: "done", msSinceStart: null },
    { sessionKey: "A", eventType: "SCORECARD_VIEW", step: null, msSinceStart: null },
    { sessionKey: "B", eventType: "COMMITTED", step: "done", msSinceStart: null },
    // C viewed a scorecard but never committed in-funnel — must not inflate the numerator.
    { sessionKey: "C", eventType: "SCORECARD_VIEW", step: null, msSinceStart: null },
  ];
  const m = computeFunnelMetrics(rows);
  assert.equal(m.committedRuns, 2);
  assert.equal(m.resolutionReturnRate, 0.5); // only A of {A,B} returned
});

test("Decision Report events never inflate the legacy funnel", () => {
  const rows: FunnelEventRow[] = [
    { sessionKey: "legacy", eventType: "LANDED", step: "paste", msSinceStart: null },
    { sessionKey: "report-a", eventType: "REPORT_LANDED", step: null, msSinceStart: 0 },
    {
      sessionKey: "report-a",
      eventType: "REPORT_ACTIVATED",
      step: null,
      msSinceStart: 9_000,
    },
    {
      sessionKey: "report-b",
      eventType: "REPORT_GENERATION_FAILED",
      step: null,
      msSinceStart: 1_000,
    },
  ];

  const metrics = computeFunnelMetrics(rows);
  assert.equal(metrics.landedRuns, 1);
  assert.equal(metrics.committedRuns, 0);
  assert.equal(metrics.commitRate, 0);
});

test("Decision Report metrics dedupe stages, expose observed dropoff, and retain failure retries", () => {
  const rows: FunnelEventRow[] = [
    { sessionKey: "A", eventType: "REPORT_LANDED", step: null, msSinceStart: 0 },
    { sessionKey: "A", eventType: "REPORT_GENERATION_STARTED", step: null, msSinceStart: 100 },
    {
      sessionKey: "A",
      eventType: "REPORT_EDITABLE",
      step: null,
      msSinceStart: 1_000,
      meta: { editCount: 2, followUpCount: 1 },
    },
    {
      sessionKey: "A",
      eventType: "REPORT_EDITABLE",
      step: null,
      msSinceStart: 1_200,
      meta: { editCount: 4, followUpCount: 1 },
    },
    { sessionKey: "A", eventType: "REPORT_SAVED", step: null, msSinceStart: 5_000 },
    { sessionKey: "A", eventType: "REPORT_SAVED", step: null, msSinceStart: 5_400 },
    { sessionKey: "A", eventType: "REPORT_ACTIVATED", step: null, msSinceStart: 9_000 },

    { sessionKey: "B", eventType: "REPORT_LANDED", step: null, msSinceStart: 0 },
    { sessionKey: "B", eventType: "REPORT_GENERATION_STARTED", step: null, msSinceStart: 100 },
    { sessionKey: "B", eventType: "REPORT_GENERATION_FAILED", step: null, msSinceStart: 800 },
    { sessionKey: "B", eventType: "REPORT_GENERATION_FAILED", step: null, msSinceStart: 900 },

    { sessionKey: "C", eventType: "REPORT_LANDED", step: null, msSinceStart: 0 },
    { sessionKey: "C", eventType: "REPORT_GENERATION_STARTED", step: null, msSinceStart: 100 },
    {
      sessionKey: "C",
      eventType: "REPORT_EDITABLE",
      step: null,
      msSinceStart: 3_000,
      meta: { editCount: 6, followUpCount: 3 },
    },
    { sessionKey: "C", eventType: "REPORT_SAVE_FAILED", step: null, msSinceStart: 6_000 },

    // An incomplete telemetry chain remains visible in stage/timing counts but
    // does not reduce dropoff for a session that never emitted the prior stage.
    { sessionKey: "D", eventType: "REPORT_ACTIVATED", step: null, msSinceStart: 700 },

    // Legacy rows are ignored by the Decision Report fold.
    { sessionKey: "legacy", eventType: "LANDED", step: "paste", msSinceStart: null },
  ];

  const metrics = computeDecisionReportFunnelMetrics(rows);
  assert.equal(metrics.distinctSessions, 4);
  assert.deepEqual(metrics.stageCounts, {
    landed: 3,
    generationStarted: 3,
    editable: 2,
    saved: 1,
    activated: 2,
  });
  assert.deepEqual(metrics.observedDropoff.landedToGenerationStarted, {
    eligibleSessions: 3,
    advancedSessions: 3,
    droppedSessions: 0,
    dropoffRate: 0,
  });
  assert.deepEqual(metrics.observedDropoff.generationStartedToEditable, {
    eligibleSessions: 3,
    advancedSessions: 2,
    droppedSessions: 1,
    dropoffRate: 1 / 3,
  });
  assert.deepEqual(metrics.observedDropoff.editableToSaved, {
    eligibleSessions: 2,
    advancedSessions: 1,
    droppedSessions: 1,
    dropoffRate: 0.5,
  });
  assert.deepEqual(metrics.observedDropoff.savedToActivated, {
    eligibleSessions: 1,
    advancedSessions: 1,
    droppedSessions: 0,
    dropoffRate: 0,
  });
  assert.deepEqual(metrics.timingMs.timeToEditable, { sampledSessions: 2, median: 2_000 });
  assert.deepEqual(metrics.timingMs.timeToSave, { sampledSessions: 1, median: 5_000 });
  assert.deepEqual(metrics.timingMs.timeToActivation, { sampledSessions: 2, median: 4_850 });
  assert.deepEqual(metrics.engagement.editCount, { sampledSessions: 2, median: 5 });
  assert.deepEqual(metrics.engagement.followUpCount, { sampledSessions: 2, median: 2 });
  assert.deepEqual(metrics.failures.generation, { events: 2, sessions: 1 });
  assert.deepEqual(metrics.failures.save, { events: 1, sessions: 1 });
  assert.deepEqual(metrics.failures.activation, { events: 0, sessions: 0 });
  assert.equal(metrics.failures.totalEvents, 3);
});

test("Decision Report metric fold ignores unsafe engagement metadata", () => {
  const metrics = computeDecisionReportFunnelMetrics([
    {
      sessionKey: "A",
      eventType: "REPORT_EDITABLE",
      step: null,
      msSinceStart: -1,
      meta: {
        editCount: "report body must never be accepted",
        followUpCount: { nested: true },
      },
    },
  ]);

  assert.deepEqual(metrics.timingMs.timeToEditable, { sampledSessions: 0, median: null });
  assert.deepEqual(metrics.engagement.editCount, { sampledSessions: 0, median: null });
  assert.deepEqual(metrics.engagement.followUpCount, { sampledSessions: 0, median: null });
});
