import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseMetricCsv } from "./csv.ts";

const fixturePath = fileURLToPath(
  new URL("../../test-fixtures/gummy-alpha-full-loop.csv", import.meta.url),
);

test("Gummy Alpha full-loop fixture has enough history and a measurable intervention", async () => {
  const result = parseMetricCsv(await readFile(fixturePath));
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.summary, {
    acceptedRows: 122,
    rejectedRows: 0,
    startDate: "2026-04-01",
    endDate: "2026-07-31",
  });

  const interventionDate = "2026-06-15";
  const before = result.observations.filter(({ date }) => date < interventionDate);
  const after = result.observations.filter(({ date }) => date >= interventionDate);
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const lift = mean(after.map(({ value }) => value)) - mean(before.map(({ value }) => value));

  assert.equal(before.length, 75);
  assert.equal(after.length, 47);
  assert.ok(lift > 14 && lift < 16, `expected an approximately 15-point lift, received ${lift}`);
});
