// Live end-to-end guardrail proof (Phase B2) — OPT-IN.
//
// Points the exact same adversarial invariant checks at a REAL Anthropic model
// through the SummaryPolisher seam, confirming that even a live LLM cannot upgrade
// or invent a causal claim: whatever it returns, enforceInvariants() clamps it to
// the deterministic verdict.
//
// Skipped by default (no key / no opt-in), so `npm test` stays hermetic and free.
// To run it live once an ANTHROPIC_API_KEY exists:
//
//     ANTHROPIC_API_KEY=sk-ant-... RUN_LIVE_POLISH=1 \
//       node --test lib/summary/__tests__/live-polish.test.ts
//
// It makes one real API call per scenario (model claude-opus-4-8).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ESTIMATED_NOT_PROVEN,
  METHOD_LABEL,
  generateSummary,
  generateSummaryWithPolish,
  violatesHonestyClaim,
} from "../index.ts";
import { createAnthropicPolisher } from "../live-polish.ts";
import { SCENARIOS, sameVerdict } from "./scenarios.ts";

const LIVE = process.env.RUN_LIVE_POLISH === "1" && !!process.env.ANTHROPIC_API_KEY;
const DIRECTIONAL = new Set(["confident", "tentative"]);

for (const sc of SCENARIOS) {
  test(
    `[live] ${sc.id}: the real model cannot break the guardrail`,
    { skip: LIVE ? false : "set RUN_LIVE_POLISH=1 and ANTHROPIC_API_KEY to run" },
    async () => {
      const core = generateSummary(sc.row);
      const out = await generateSummaryWithPolish(sc.row, createAnthropicPolisher());

      assert.ok(sameVerdict(out, core), `verdict drifted under the live model on ${sc.id}`);
      assert.equal(out.claimStrength, sc.expect);
      assert.equal(out.method, METHOD_LABEL);
      for (const t of [out.headline, ...out.detail]) {
        assert.equal(violatesHonestyClaim(t), false, `live prose tripped the guard: "${t}"`);
      }
      if (DIRECTIONAL.has(out.claimStrength)) {
        assert.ok(
          out.headline.toLowerCase().startsWith(ESTIMATED_NOT_PROVEN.toLowerCase()),
          `live directional headline lost the lead: ${out.headline}`,
        );
      }
    },
  );
}
