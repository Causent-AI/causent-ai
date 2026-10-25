import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProjectSetup } from "./setup.ts";
test("Day 0 accepts a goal without metrics, data, or milestones", () => {
  assert.deepEqual(parseProjectSetup({ title: " Website ", goal: "Launch a website", metrics: "", milestones: "" }),
    { ok: true, value: { title: "Website", goal: "Launch a website", metrics: [], milestones: [] } });
});
test("completion milestones remain distinct from planned performance metrics", () => {
  const result = parseProjectSetup({ title: "Website", goal: "Launch", metrics: "Conversion rate\r\nVisitors", milestones: "Analytics installed\nWebsite launched" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.metrics, ["Conversion rate", "Visitors"]);
    assert.deepEqual(result.value.milestones, ["Analytics installed", "Website launched"]);
  }
});
test("rejects missing goals and oversized lists", () => {
  assert.equal(parseProjectSetup({ title: "Website", goal: " ", metrics: "", milestones: "" }).ok, false);
  assert.equal(parseProjectSetup({ title: "Website", goal: "Launch", metrics: Array(31).fill("Visitors").join("\n"), milestones: "" }).ok, false);
});
