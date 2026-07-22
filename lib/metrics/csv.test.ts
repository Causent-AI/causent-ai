import assert from "node:assert/strict";
import { test } from "node:test";
import { METRIC_CSV_MAX_BYTES, parseMetricCsv } from "./csv.ts";

const bytes = (value: string) => new TextEncoder().encode(value);

test("parses, sorts, and deterministically normalizes daily observations", () => {
  const result = parseMetricCsv(bytes("\ufeffdate,value\r\n2026-07-22,1.5\r\n2026-07-20,-2e1\r\n"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.observations, [
    { date: "2026-07-20", value: -20 },
    { date: "2026-07-22", value: 1.5 },
  ]);
  assert.deepEqual(result.summary, {
    acceptedRows: 2,
    rejectedRows: 0,
    startDate: "2026-07-20",
    endDate: "2026-07-22",
  });
});

test("requires the exact unambiguous date,value header", () => {
  for (const header of ["value,date", "Date,value", "date, value", '"date","value"']) {
    const result = parseMetricCsv(bytes(`${header}\n2026-07-22,1`));
    assert.equal(result.ok, false, header);
    if (!result.ok) assert.equal(result.code, "header");
  }
});

test("rejects invalid dates, numbers, padded fields, quotes, and duplicates atomically", () => {
  const result = parseMetricCsv(bytes([
    "date,value",
    "2026-07-20,1",
    "2026-02-30,2",
    "2026-07-21,NaN",
    "2026-07-22, 3",
    '2026-07-23,"4"',
    "2026-07-20,5",
  ].join("\n")));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "row");
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.rejectedRows, 5);
  assert.match(result.error, /No observations were written/);
  assert.ok(result.details.some((detail) => detail.includes("duplicate date")));
});

test("rejects binary, invalid UTF-8, empty, oversized, and over-row-limit files", () => {
  assert.equal(parseMetricCsv(new Uint8Array()).ok, false);
  assert.equal(parseMetricCsv(new Uint8Array([0, 1, 2])).ok, false);
  assert.equal(parseMetricCsv(new Uint8Array([0xff])).ok, false);
  const oversized = parseMetricCsv(new Uint8Array(METRIC_CSV_MAX_BYTES + 1));
  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.equal(oversized.code, "too_large");
  const tooMany = parseMetricCsv(bytes(`date,value\n${Array.from({ length: 10_001 }, (_, i) => `2026-01-01,${i}`).join("\n")}`));
  assert.equal(tooMany.ok, false);
  if (!tooMany.ok) assert.equal(tooMany.code, "row_limit");
});
