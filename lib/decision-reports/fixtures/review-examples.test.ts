import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DECISION_REPORT_GOLDEN_EXAMPLES,
  findDecisionReportGoldenExample,
} from "./index.ts";
import {
  DECISION_REPORT_REVIEW_EXAMPLES,
  findDecisionReportReviewExampleById,
  validateDecisionReportReviewExampleSelection,
} from "./review-examples.ts";

test("every review card resolves to its exact deterministic fixture", () => {
  assert.equal(DECISION_REPORT_REVIEW_EXAMPLES.length, 2);
  assert.equal(DECISION_REPORT_GOLDEN_EXAMPLES.length, 2);

  for (const card of DECISION_REPORT_REVIEW_EXAMPLES) {
    const fixture = findDecisionReportGoldenExample(card.prompt);
    assert.ok(fixture, `${card.id} did not resolve to a deterministic fixture`);
    assert.equal(fixture.projectName, card.project);
  }
});

test("fixture matching is exact and fails closed for an edited prompt", () => {
  const prompt = DECISION_REPORT_REVIEW_EXAMPLES[1].prompt;
  assert.ok(findDecisionReportGoldenExample(prompt));
  assert.equal(findDecisionReportGoldenExample(`${prompt} Changed.`), null);
});

test("review examples resolve only through their explicit allowlisted IDs", () => {
  assert.equal(findDecisionReportReviewExampleById("gummy-alpha")?.project, "Gummy Alpha");
  assert.equal(
    findDecisionReportReviewExampleById("northstar-support")?.project,
    "Northstar Support",
  );
  assert.equal(findDecisionReportReviewExampleById("unknown-example"), null);
  assert.equal(findDecisionReportReviewExampleById(null), null);
});

test("explicit samples are accepted only with their exact prompt and no extra sources", () => {
  const example = DECISION_REPORT_REVIEW_EXAMPLES[1];
  assert.deepEqual(
    validateDecisionReportReviewExampleSelection({
      id: example.id,
      prompt: example.prompt,
      hasAdditionalSources: false,
    }),
    { ok: true, example },
  );
  assert.deepEqual(
    validateDecisionReportReviewExampleSelection({
      id: example.id,
      prompt: `${example.prompt} Changed.`,
      hasAdditionalSources: false,
    }),
    { ok: false, reason: "changed_input" },
  );
  assert.deepEqual(
    validateDecisionReportReviewExampleSelection({
      id: example.id,
      prompt: example.prompt,
      hasAdditionalSources: true,
    }),
    { ok: false, reason: "changed_input" },
  );
  assert.deepEqual(
    validateDecisionReportReviewExampleSelection({
      id: "forged-example",
      prompt: example.prompt,
      hasAdditionalSources: false,
    }),
    { ok: false, reason: "invalid_id" },
  );
});
