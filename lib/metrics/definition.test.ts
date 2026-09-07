import assert from "node:assert/strict";
import test from "node:test";
import { parseMetricDefinition } from "./definition.ts";

const definition = {
  numericScale: "points", beneficialDirection: "lower", aggregation: "rate",
  denominator: " eligible sessions ",
};

test("metric confirmation preserves explicit scale and normalizes its population", () => {
  assert.deepEqual(parseMetricDefinition(definition, "percent"), {
    ...definition, denominator: "eligible sessions",
  });
  assert.equal(parseMetricDefinition({ ...definition, numericScale: "ratio" }, "percent")?.numericScale, "ratio");
});

test("missing, malformed and mismatched definitions cannot be inferred", () => {
  for (const value of [null, undefined, [], "0.5", {}, { ...definition, denominator: 7 },
    { ...definition, beneficialDirection: "unknown" }, { ...definition, numericScale: "native" },
    { ...definition, denominator: " " }, { ...definition, aggregation: "whatever" }]) {
    assert.equal(parseMetricDefinition(value, "percent"), null);
  }
  assert.equal(parseMetricDefinition(definition, "count"), null);
  assert.equal(parseMetricDefinition({ ...definition, numericScale: "native" }, "count")?.numericScale, "native");
});
