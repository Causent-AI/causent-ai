// Regression lock for the honest-summary layer (Phase B2).
//
// golden.json pins the EXACT deterministic summary for every adversarial scenario.
// A future edit that quietly loosens the guardrail — dropping the "estimated, not
// proven" lead, softening a caveat, re-labelling the method, upgrading a strength —
// changes the rendered summary, and this deep-equal diff fails loudly.
//
// The golden is the deterministic core (generateSummary), which is the single
// source of truth the polish seam is clamped back to.
//
// Run:            `node --test lib/summary/__tests__/regression.test.ts`
// Re-bless:       `UPDATE_GOLDEN=1 node --test lib/summary/__tests__/regression.test.ts`
//   (only after a DELIBERATE, reviewed wording change — never to make red go green.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

import { generateSummary, type Summary } from "../index.ts";
import { SCENARIOS } from "./scenarios.ts";

const GOLDEN_URL = new URL("./golden.json", import.meta.url);

/** The current deterministic summary for every scenario, keyed by id. */
function currentBaseline(): Record<string, Summary> {
  const out: Record<string, Summary> = {};
  for (const sc of SCENARIOS) out[sc.id] = generateSummary(sc.row);
  return out;
}

if (process.env.UPDATE_GOLDEN) {
  test("UPDATE_GOLDEN: re-bless the regression baseline", () => {
    writeFileSync(GOLDEN_URL, JSON.stringify(currentBaseline(), null, 2) + "\n");
  });
} else {
  const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as Record<string, Summary>;
  const baseline = currentBaseline();

  test("golden covers exactly the current scenario set (no drift in coverage)", () => {
    assert.deepEqual(Object.keys(baseline).sort(), Object.keys(golden).sort());
  });

  for (const sc of SCENARIOS) {
    test(`[golden] ${sc.id}: summary matches the locked baseline`, () => {
      assert.ok(golden[sc.id], `no golden entry for ${sc.id} — re-bless with UPDATE_GOLDEN=1`);
      assert.deepEqual(baseline[sc.id], golden[sc.id]);
    });
  }
}
