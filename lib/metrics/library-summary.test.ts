import { test } from "node:test";
import assert from "node:assert/strict";
import { metricLibrarySummary } from "./library-summary.ts";
const series = Array.from({ length: 28 }, (_, i) => ({
  date: `2026-09-${String(i + 1).padStart(2, "0")}`,
  value: i >= 21 ? 20 : 10,
}));
test("metric library uses complete calendar windows", () => {
  assert.deepEqual(metricLibrarySummary(series), {
    latest: 20,
    average: 12.5,
    wow: 100,
  });
  assert.deepEqual(metricLibrarySummary([]), {
    latest: null,
    average: null,
    wow: null,
  });
});
test("missing days and zero baselines do not become growth claims", () => {
  assert.equal(
    metricLibrarySummary(series.filter((_, i) => i !== 23)).wow,
    null,
  );
  assert.equal(metricLibrarySummary(series.slice(1)).average, null);
  assert.equal(
    metricLibrarySummary(series.map((p) => ({ ...p, value: 0 }))).wow,
    null,
  );
});
