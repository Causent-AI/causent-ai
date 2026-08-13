import assert from "node:assert/strict";
import test from "node:test";
import type { Observation } from "../types.ts";
import {
  calculateChangeSeries,
  filterSeriesRange,
  prepareSeries,
  prepareSeriesView,
  rollupSeries,
} from "./series-controls.ts";

function daily(count: number): Observation[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    date.setUTCDate(date.getUTCDate() + index);
    return { date: date.toISOString().slice(0, 10), value: index + 1 };
  });
}

test("range controls use calendar days ending on the latest observation", () => {
  const series = daily(100);
  const filtered = filterSeriesRange(series, "30d");
  assert.equal(filtered.length, 30);
  assert.equal(filtered[0].date, "2026-03-12");
  assert.equal(filtered.at(-1)?.date, "2026-04-10");
  assert.equal(filterSeriesRange(series, "all"), series);
});

test("weekly cadence averages observations into Monday-anchored buckets", () => {
  const rolled = rollupSeries([
    { date: "2026-07-20", value: 10 },
    { date: "2026-07-21", value: 20 },
    { date: "2026-07-27", value: 40 },
  ], "weekly");
  assert.deepEqual(rolled, [
    { date: "2026-07-20", value: 15 },
    { date: "2026-07-27", value: 40 },
  ]);
});

test("preparation retains weekly buckets that intersect the selected range", () => {
  const prepared = prepareSeries(daily(100), "30d", "weekly");
  assert.equal(prepared[0].date, "2026-03-09");
  assert.equal(prepared.at(-1)?.date, "2026-04-06");
});

test("daily WoW uses the exact date seven calendar days earlier", () => {
  const changes = calculateChangeSeries([
    { date: "2026-01-01", value: 10 },
    { date: "2026-01-08", value: 15 },
    { date: "2026-01-09", value: 99 },
  ], "wow", "daily");

  assert.deepEqual(changes, [
    { date: "2026-01-01", value: null },
    { date: "2026-01-08", value: 50 },
    { date: "2026-01-09", value: null },
  ]);
});

test("daily MoM uses the prior calendar month and clamps month ends", () => {
  const changes = calculateChangeSeries([
    { date: "2026-02-28", value: 100 },
    { date: "2026-03-31", value: 125 },
  ], "mom", "daily");

  assert.equal(changes[0].value, null);
  assert.equal(changes[1].value, 25);
});

test("weekly MoM resolves the shifted calendar date to its Monday bucket", () => {
  const changes = calculateChangeSeries([
    { date: "2026-02-23", value: 100 },
    { date: "2026-03-30", value: 120 },
  ], "mom", "weekly");

  assert.equal(changes[1].value, 20);
});

test("missing and zero baselines remain explicit gaps", () => {
  const changes = calculateChangeSeries([
    { date: "2026-01-01", value: 0 },
    { date: "2026-01-08", value: 20 },
    { date: "2026-01-16", value: 30 },
  ], "wow", "daily");

  assert.deepEqual(changes.map(({ value }) => value), [null, null, null]);
});

test("negative baselines use absolute magnitude without losing change direction", () => {
  const changes = calculateChangeSeries([
    { date: "2026-01-01", value: -10 },
    { date: "2026-01-08", value: -5 },
  ], "wow", "daily");

  assert.equal(changes[1].value, 50);
});

test("rate baselines are calculated from full history before range clipping", () => {
  const view = prepareSeriesView(daily(100), "30d", "daily");

  assert.equal(view.levels[0].date, "2026-03-12");
  assert.notEqual(view.wow[0].value, null);
  assert.notEqual(view.mom[0].value, null);
  assert.deepEqual(
    view.levels.map(({ date }) => date),
    view.wow.map(({ date }) => date),
  );
  assert.deepEqual(
    view.levels.map(({ date }) => date),
    view.mom.map(({ date }) => date),
  );
});

test("a 30-day daily view keeps a populated MoM series when prior history exists", () => {
  const view = prepareSeriesView(daily(122), "30d", "daily");

  assert.equal(view.levels.length, 30);
  assert.equal(view.mom.length, 30);
  assert.equal(view.mom.filter(({ value }) => value !== null).length, 30);
});

test("weekly views retain intersecting buckets and their pre-window baselines", () => {
  const view = prepareSeriesView(daily(100), "30d", "weekly");

  assert.equal(view.levels[0].date, "2026-03-09");
  assert.notEqual(view.wow[0].value, null);
  assert.notEqual(view.mom[0].value, null);
});

test("empty series produces an aligned empty view", () => {
  assert.deepEqual(prepareSeriesView([], "all", "daily"), {
    levels: [],
    wow: [],
    mom: [],
  });
});
