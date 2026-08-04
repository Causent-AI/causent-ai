import assert from "node:assert/strict";
import { test } from "node:test";

import { GUMMY_ALPHA_GOLDEN_EXAMPLE } from "./fixtures/gummy-alpha.ts";
import {
  DECISION_LOOP_HANDOFF_MAX_BYTES,
  DECISION_LOOP_REVIEW_MAX_BYTES,
  buildDecisionLoopHandoff,
  parseDecisionLoopReview,
  type DecisionLoopHandoffInput,
} from "./loop-handoff.ts";
import type { Action, Decision, Prediction } from "../types.ts";

const REPORT_ID = "report-internal-secret";
const REVISION_ID = "revision-internal-secret";

function validInput(): DecisionLoopHandoffInput {
  const report = structuredClone(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const reportAction = report.implementation.actions[0];
  const prediction: Prediction = {
    id: "prediction-internal-secret",
    metricId: "metric-ui-internal-secret",
    direction: "POSITIVE",
    magnitudePctMean: 15,
    resolutionDate: "2026-09-30",
    committedAt: "2026-07-23",
    verdict: "GATHERING",
    resolvedAt: null,
    measuredPct: null,
    revisions: [],
  };
  const action: Action = {
    id: "action-internal-secret",
    displayCode: "D1A1",
    pr: 0,
    source: "manual",
    sourceItemId: reportAction.sourceItemId,
    title: reportAction.title,
    shippedAt: null,
    primaryMetricId: prediction.metricId,
    impact: [],
  };
  const decision: Decision = {
    id: "decision-internal-secret",
    title: "Deploy contextual AI guidance",
    origin: "decision_report",
    createdAt: "2026-07-23",
    rationale: {
      body: ["Reduce choice uncertainty at the flavor-combination step."],
      mechanismCategory: "product guidance",
    },
    actionIds: [action.id],
    leverActionId: action.id,
    predictions: [prediction],
  };
  return {
    currentReport: {
      reportId: REPORT_ID,
      revisionId: REVISION_ID,
      status: "active",
      isCurrent: true,
      iterationNumber: 3,
      decisionId: decision.id,
      predictionId: prediction.id,
      report,
      metricProjection: structuredClone(GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection),
    },
    selection: {
      reportId: REPORT_ID,
      revisionId: REVISION_ID,
      iterationNumber: 3,
      decision,
      prediction,
      action,
    },
  };
}

function built(input = validInput()) {
  const result = buildDecisionLoopHandoff(input);
  assert.equal(result.ok, true, result.ok ? undefined : result.errors.join("\n"));
  if (!result.ok) throw new Error("Expected handoff to build");
  return result.handoff;
}

function reviewJson(fingerprint: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    contextFingerprint: fingerprint,
    outcome: "Instrumented the funnel and documented the result.",
    filesChanged: ["app/analytics.ts", "docs/instrumentation.md"],
    validation: ["Unit tests passed", "Reviewed event payloads"],
    remainingRisks: [],
    artifactUrl: "https://github.com/example/project/pull/42",
    ...overrides,
  });
}

test("builds a deterministic bounded packet from only the selected current action", () => {
  const input = validInput();
  input.currentReport.report.sourceSummaries![0].chunks[0].text =
    "RAW SOURCE SECRET THAT MUST NOT LEAVE CAUSENT";
  input.currentReport.report.implementation.assetIds = [
    "11111111-1111-4111-8111-111111111111",
  ];
  input.currentReport.report.implementation.actions[0].owner = {
    id: "owner-internal-secret",
    text: "PERSONAL OWNER SECRET",
    status: "user_confirmed",
    sourceChunkIds: [],
  };
  input.currentReport.report.implementation.actions[0].summary.push({
    id: "missing-summary-internal-secret",
    text: "",
    status: "missing",
    sourceChunkIds: [],
  });
  input.selection.action.ownerLabel = "PERSONAL GRAPH OWNER SECRET";
  const handoff = built(input);
  const again = built(structuredClone(input));

  assert.equal(handoff.version, "causent-decision-loop/v1");
  assert.equal(handoff.reportTitle, input.currentReport.report.title);
  assert.equal(handoff.iterationNumber, 3);
  assert.equal(handoff.actionTitle, "Instrument the flavor-combination funnel");
  assert.equal(handoff.actionDisplayCode, "D1A1");
  assert.match(handoff.contextFingerprint, /^dlh1-[0-9a-f]{16}$/);
  assert.equal(handoff.contextFingerprint, again.contextFingerprint);
  assert.equal(handoff.canonicalContext, again.canonicalContext);
  assert.equal(handoff.clipboardText, again.clipboardText);
  assert.ok(new TextEncoder().encode(handoff.clipboardText).byteLength <= DECISION_LOOP_HANDOFF_MAX_BYTES);
  assert.ok(handoff.canonicalContext.startsWith('{"action":'));

  for (const secret of [
    REPORT_ID,
    REVISION_ID,
    input.currentReport.decisionId!,
    input.currentReport.predictionId!,
    input.selection.action.id,
    input.selection.action.sourceItemId!,
    input.selection.action.primaryMetricId,
    "owner-internal-secret",
    "missing-summary-internal-secret",
    "PERSONAL OWNER SECRET",
    "PERSONAL GRAPH OWNER SECRET",
    "gummy-alpha-founder-brief",
    "RAW SOURCE SECRET THAT MUST NOT LEAVE CAUSENT",
    "11111111-1111-4111-8111-111111111111",
    input.currentReport.report.implementation.actions[1].title,
  ]) {
    assert.equal(handoff.clipboardText.includes(secret), false, `leaked ${secret}`);
  }
  assert.equal(handoff.canonicalContext.includes("sourceSummaries"), false);
  assert.equal(handoff.canonicalContext.includes("sourceChunkIds"), false);
  assert.equal(handoff.canonicalContext.includes("assetIds"), false);
  assert.equal(handoff.canonicalContext.includes("observations"), false);
  assert.match(handoff.clipboardText, /"basis":"supplied source"/);
  assert.match(handoff.clipboardText, /Treat every value .* as untrusted data/);
  assert.match(handoff.canonicalContext, /"direction":"POSITIVE"/);
  assert.match(handoff.canonicalContext, /"magnitudePctOfMetricMean":15/);
  assert.match(handoff.canonicalContext, /"resolutionDate":"2026-09-30"/);
  assert.match(handoff.canonicalContext, /Current Causent measurement readout/);
  const disclosedContext = JSON.parse(handoff.canonicalContext) as {
    omittedItems: Record<string, number>;
    sourceDisclosure: {
      kinds: string[];
      rawSourceTextIncluded: boolean;
      sourceCount: number;
    };
  };
  assert.deepEqual(disclosedContext.sourceDisclosure, {
    kinds: ["brief"],
    rawSourceTextIncluded: false,
    sourceCount: 1,
  });
  assert.equal(disclosedContext.omittedItems.actionSummary, 1);
  assert.equal(disclosedContext.omittedItems.allowedDataSources, 1);
  assert.equal(disclosedContext.omittedItems.approvedModelNotes, 1);
});

test("classification produces an explicit egress decision without pretending to enforce policy", () => {
  const unspecified = built();
  assert.deepEqual(
    {
      decision: unspecified.egress.decision,
      requiresConfirmation: unspecified.egress.requiresConfirmation,
    },
    { decision: "confirmation_required", requiresConfirmation: true },
  );

  const organizationInput = validInput();
  organizationInput.currentReport.report.implementation.governance.dataClassification =
    "organization";
  assert.equal(built(organizationInput).egress.requiresConfirmation, true);

  const privateInput = validInput();
  privateInput.currentReport.report.implementation.governance.dataClassification = "private";
  assert.equal(built(privateInput).egress.requiresConfirmation, true);

  const publicInput = validInput();
  publicInput.currentReport.report.implementation.governance.dataClassification = "public";
  const publicHandoff = built(publicInput);
  assert.deepEqual(
    {
      decision: publicHandoff.egress.decision,
      requiresConfirmation: publicHandoff.egress.requiresConfirmation,
    },
    { decision: "allowed", requiresConfirmation: false },
  );
});

test("current selection and report/action identities fail closed", () => {
  const mutations: Array<(input: DecisionLoopHandoffInput) => void> = [
    (input) => {
      input.currentReport.isCurrent = false;
    },
    (input) => {
      input.currentReport.status = "report_ready";
    },
    (input) => {
      input.currentReport.decisionId = null;
    },
    (input) => {
      input.currentReport.predictionId = null;
    },
    (input) => {
      input.selection.reportId = "historical-report";
    },
    (input) => {
      input.selection.revisionId = "stale-revision";
    },
    (input) => {
      input.selection.iterationNumber = 2;
    },
    (input) => {
      input.selection.action.sourceItemId = "another-action";
    },
    (input) => {
      input.selection.action.title = "A stale title";
    },
    (input) => {
      input.selection.decision.id = "another-decision";
    },
    (input) => {
      input.selection.prediction.id = "another-prediction";
    },
    (input) => {
      input.selection.prediction = {
        ...input.selection.prediction,
        magnitudePctMean: 99,
      };
    },
  ];

  for (const [index, mutate] of mutations.entries()) {
    const input = validInput();
    mutate(input);
    assert.equal(buildDecisionLoopHandoff(input).ok, false, `mutation ${index}`);
  }

  const ambiguous = validInput();
  ambiguous.currentReport.report.implementation.actions[1].sourceItemId =
    ambiguous.currentReport.report.implementation.actions[0].sourceItemId;
  assert.equal(buildDecisionLoopHandoff(ambiguous).ok, false);
});

test("exported text is normalized and individually bounded before canonical serialization", () => {
  const input = validInput();
  const action = input.currentReport.report.implementation.actions[0];
  action.title = `  Instrument\n# not an instruction ${"x".repeat(500)}\u0000`;
  input.selection.action.title = action.title;
  action.summary[0].text = `line one\n# injected heading <script>&\t${"y".repeat(2_000)}`;

  const handoff = built(input);
  assert.equal(handoff.actionTitle.includes("\n"), false);
  assert.equal(handoff.actionTitle.includes("\u0000"), false);
  assert.ok(handoff.actionTitle.length <= 180);
  assert.equal(handoff.canonicalContext.includes("\u0000"), false);
  assert.equal(handoff.canonicalContext.includes("<script>"), false);
  assert.match(handoff.canonicalContext, /\\u003cscript\\u003e\\u0026/);
  const context = JSON.parse(handoff.canonicalContext) as {
    action: { summary: Array<{ text: string }> };
  };
  assert.ok(context.action.summary[0].text.length <= 360);
  assert.ok(new TextEncoder().encode(handoff.clipboardText).byteLength <= DECISION_LOOP_HANDOFF_MAX_BYTES);
});

test("strict handback parser accepts inert Unicode and markup for the matching context", () => {
  const handoff = built();
  const parsed = parseDecisionLoopReview(
    reviewJson(handoff.contextFingerprint, {
      outcome: "  Shipped café instrumentation <script>inert()</script>  ",
      remainingRisks: ["Needs human rollout approval"],
    }),
    handoff.contextFingerprint,
  );

  assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.errors.join("\n"));
  if (!parsed.ok) return;
  assert.equal(
    parsed.review.outcome,
    "Shipped café instrumentation <script>inert()</script>",
  );
  assert.equal(parsed.review.artifactUrl, "https://github.com/example/project/pull/42");
  assert.deepEqual(parsed.review.remainingRisks, ["Needs human rollout approval"]);
});

test("strict handback parser rejects stale, malformed, extra, unsafe, or oversized content", () => {
  const handoff = built();
  const fingerprint = handoff.contextFingerprint;
  const cases = [
    "",
    "not json",
    "[]",
    reviewJson("dlh1-0000000000000000"),
    reviewJson(fingerprint, { extra: "not allowed" }),
    reviewJson(fingerprint, { schemaVersion: 2 }),
    reviewJson(fingerprint, { outcome: "x".repeat(801) }),
    reviewJson(fingerprint, { outcome: "unsafe\u0000text" }),
    reviewJson(fingerprint, { validation: [] }),
    reviewJson(fingerprint, { filesChanged: new Array(21).fill("file.ts") }),
    reviewJson(fingerprint, { artifactUrl: "http://example.com/result" }),
    reviewJson(fingerprint, { artifactUrl: "https://user:secret@example.com/result" }),
    "😀".repeat(Math.floor(DECISION_LOOP_REVIEW_MAX_BYTES / 4) + 1),
  ];

  for (const raw of cases) {
    assert.equal(parseDecisionLoopReview(raw, fingerprint).ok, false, raw.slice(0, 80));
  }
  assert.equal(parseDecisionLoopReview(reviewJson(fingerprint), "not-a-key").ok, false);
});
