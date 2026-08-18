import assert from "node:assert/strict";
import { test } from "node:test";

import { parseDriftSnapshot } from "./drift-snapshot.ts";

const PREDICTION = "ca5e0000-0000-0000-0000-000000000075";

function row(overrides: Record<string, unknown> = {}) {
  return {
    prediction_id: PREDICTION,
    refresh_status: "current",
    detector_status: "FIRED",
    reason: "fired",
    shift_date: "2026-01-20",
    pre_level: 20,
    post_level: 12,
    delta_native: -8,
    pct_change: -40,
    direction: "down",
    ci_low: -8.5,
    ci_high: -7.5,
    n_pre: 45,
    n_post: 45,
    requested_generation: 3,
    processed_generation: 3,
    requested_at: "2026-08-16T12:00:00Z",
    computed_at: "2026-08-16T12:00:01Z",
    last_processed_at: "2026-08-16T12:00:01Z",
    next_attempt_at: null,
    ...overrides,
  };
}

test("current materialization exposes the detector fact and freshness receipt", () => {
  const snapshot = parseDriftSnapshot([row()]);
  assert.deepEqual(snapshot.byPrediction.get(PREDICTION), {
    status: "FIRED",
    reason: "fired",
    shiftDate: "2026-01-20",
    preLevel: 20,
    postLevel: 12,
    deltaNative: -8,
    pctChange: -40,
    direction: "down",
    ciLow: -8.5,
    ciHigh: -7.5,
    nPre: 45,
    nPost: 45,
  });
  assert.deepEqual(snapshot.freshnessByPrediction.get(PREDICTION), {
    status: "current",
    requestedGeneration: 3,
    processedGeneration: 3,
    requestedAt: "2026-08-16T12:00:00Z",
    computedAt: "2026-08-16T12:00:01Z",
    lastProcessedAt: "2026-08-16T12:00:01Z",
    nextAttemptAt: null,
  });
});

test("non-current rows expose freshness metadata but no detector fact", () => {
  for (const status of ["queued", "processing", "retrying", "failed", "missing"]) {
    const snapshot = parseDriftSnapshot([
      row({
        refresh_status: status,
        detector_status: null,
        reason: null,
        shift_date: null,
        pre_level: null,
        post_level: null,
        delta_native: null,
        pct_change: null,
        direction: null,
        ci_low: null,
        ci_high: null,
        n_pre: null,
        n_post: null,
        computed_at: null,
      }),
    ]);
    assert.equal(snapshot.byPrediction.size, 0);
    assert.equal(snapshot.freshnessByPrediction.get(PREDICTION)?.status, status);
  }
});

test("one malformed, duplicate, or over-limit row fails the whole snapshot closed", () => {
  const malformed = parseDriftSnapshot([row(), row({ prediction_id: "forged" })]);
  assert.equal(malformed.byPrediction.size, 0);
  assert.equal(malformed.freshnessByPrediction.size, 0);

  const duplicate = parseDriftSnapshot([row(), row()]);
  assert.equal(duplicate.byPrediction.size, 0);
  assert.equal(duplicate.freshnessByPrediction.size, 0);

  const overLimit = parseDriftSnapshot(Array.from({ length: 501 }, () => row()));
  assert.equal(overLimit.byPrediction.size, 0);
  assert.equal(overLimit.freshnessByPrediction.size, 0);
});

test("stale statuses cannot smuggle a detector result", () => {
  const snapshot = parseDriftSnapshot([row({ refresh_status: "queued" })]);
  assert.equal(snapshot.byPrediction.size, 0);
  assert.equal(snapshot.freshnessByPrediction.size, 0);

  const hiddenField = parseDriftSnapshot([row({
    refresh_status: "queued",
    detector_status: null,
  })]);
  assert.equal(hiddenField.freshnessByPrediction.size, 0);
});

test("a current claim requires one coherent completed generation", () => {
  for (const overrides of [
    { processed_generation: 2 },
    { computed_at: null },
    { last_processed_at: null },
    { next_attempt_at: "2026-08-16T12:01:00Z" },
  ]) {
    const snapshot = parseDriftSnapshot([row(overrides)]);
    assert.equal(snapshot.byPrediction.size, 0);
    assert.equal(snapshot.freshnessByPrediction.size, 0);
  }
});
