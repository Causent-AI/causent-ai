import assert from "node:assert/strict";
import { test } from "node:test";

import {
  INITIAL_PROMPT_SOURCE_ID,
  createSafeFallbackReport,
  materializeModelDecisionReport,
  recoverStringifiedModelDecisionReportDraft,
  validateModelDecisionReportDraft,
  type ModelClaimDraft,
  type ModelDecisionReportDraft,
} from "./generation-contract.ts";
import { createReportSourceCorpus } from "./sources/corpus.ts";
import {
  DecisionReportGenerationTimeoutError,
  runWithSingleRetry,
} from "./generation-policy.ts";

const PROMPT =
  "Launch an AI helper for checkout. Shoppers abandon checkout. Baseline completion is 40% and the founder prediction is 55%. The product lead is Maya.";

function claim(
  text: string,
  kind: ModelClaimDraft["kind"] = "suggestion",
  evidenceQuote = "",
  evidenceSourceChunkId = kind === "supported" ? INITIAL_PROMPT_SOURCE_ID : "",
): ModelClaimDraft {
  return { text, kind, evidenceQuote, evidenceSourceChunkId };
}

function draft(): ModelDecisionReportDraft {
  return {
    projectName: "Checkout Helper",
    title: "AI guidance for checkout",
    decision: {
      decision: claim(
        "Launch an AI helper for checkout.",
        "supported",
        "Launch an AI helper for checkout.",
      ),
      background: claim("An AI helper is being considered.", "inference"),
      problem: claim(
        "Shoppers abandon checkout.",
        "supported",
        "Shoppers abandon checkout.",
      ),
    },
    supportingEvidence: {
      factors: [claim("Shoppers abandon checkout.", "supported", "Shoppers abandon checkout.")],
      metricMechanism: claim("Guidance may reduce uncertainty.", "inference"),
    },
    implementation: {
      actionPlanSummary: claim("Instrument, build, and test the helper."),
      actions: [
        {
          title: "Instrument checkout",
          summary: claim("Measure checkout starts and completions."),
          owner: claim("Maya", "supported", "The product lead is Maya."),
        },
      ],
      customers: [claim("Enterprise customers", "inference")],
      stakeholders: [claim("Maya", "supported", "The product lead is Maya.")],
      governance: {
        dataClassification: "unspecified",
        allowedDataSources: [claim("", "missing")],
        approvedModelNotes: [claim("", "missing")],
      },
    },
    metric: {
      name: "Checkout completion rate",
      definition: "Completed checkouts divided by checkout starts",
      baselinePct: 40,
      baselineEvidenceQuote: "Baseline completion is 40%",
      baselineSourceChunkId: INITIAL_PROMPT_SOURCE_ID,
      predictedPct: 55,
      predictedEvidenceQuote: "the founder prediction is 55%",
      predictedSourceChunkId: INITIAL_PROMPT_SOURCE_ID,
    },
  };
}

test("model draft validation rejects malformed structured output", () => {
  const result = validateModelDecisionReportDraft({ title: "Incomplete" });
  assert.equal(result.success, false);
});

test("model generation accepts 25 draft actions and rejects a 26th", () => {
  const generated = draft();
  generated.implementation.actions = Array.from({ length: 25 }, (_, index) => ({
    title: `Action ${index + 1}`,
    summary: claim(`Complete action ${index + 1}.`),
    owner: null,
  }));
  assert.equal(validateModelDecisionReportDraft(generated).success, true);

  generated.implementation.actions.push({
    title: "Action 26",
    summary: claim("This action exceeds the report limit."),
    owner: null,
  });
  assert.equal(validateModelDecisionReportDraft(generated).success, false);
});

test("provider-stringified structured output is recovered only after full validation", () => {
  const expected = draft();
  const wrapped = JSON.stringify({ decision: JSON.stringify(expected) });
  const objectWrapped = JSON.stringify({ decision: expected });
  const stringifiedSections = JSON.stringify({
    ...expected,
    decision: JSON.stringify(expected.decision),
    supportingEvidence: JSON.stringify(expected.supportingEvidence),
    implementation: JSON.stringify(expected.implementation),
    metric: JSON.stringify(expected.metric),
  });

  assert.deepEqual(recoverStringifiedModelDecisionReportDraft(wrapped), expected);
  assert.deepEqual(recoverStringifiedModelDecisionReportDraft(objectWrapped), expected);
  assert.deepEqual(recoverStringifiedModelDecisionReportDraft(stringifiedSections), expected);
  assert.equal(
    recoverStringifiedModelDecisionReportDraft(
      JSON.stringify({ decision: JSON.stringify({ title: "Incomplete" }) }),
    ),
    null,
  );
  assert.equal(recoverStringifiedModelDecisionReportDraft("not json"), null);
});

test("server materialization assigns IDs and verifies exact prompt evidence", () => {
  let nextId = 0;
  const result = materializeModelDecisionReport(draft(), PROMPT, {
    idFactory: () => String(++nextId),
  });

  assert.equal(result.report.decision.decision[0].status, "sourced");
  assert.deepEqual(result.report.decision.decision[0].sourceChunkIds, ["initial-prompt"]);
  assert.match(result.report.decision.decision[0].id, /^decision-\d+$/);
  assert.equal(result.report.implementation.actions[0].owner?.status, "sourced");
  assert.equal(result.metricProjection.baselinePct, 40);
  assert.equal(result.metricProjection.predictedPct, 55);
  assert.deepEqual(result.sourceSummaries.map((source) => source.kind), ["brief"]);
  assert.deepEqual(result.report.sourceSummaries, result.sourceSummaries);
});

test("proposed rationale stays labeled as a suggestion without source attribution", () => {
  const generated = draft();
  generated.supportingEvidence.factors = [
    claim("Shorter setup may reduce customer confusion.", "suggestion"),
  ];

  const result = materializeModelDecisionReport(generated, PROMPT, {
    idFactory: () => "suggested-rationale",
  });
  assert.equal(result.report.supportingEvidence.factors[0].status, "suggested");
  assert.deepEqual(result.report.supportingEvidence.factors[0].sourceChunkIds, []);
});

test("supported claims and metrics must quote the exact named source chunk", () => {
  let sourceId = 0;
  const corpus = createReportSourceCorpus(
    PROMPT,
    [
      {
        kind: "url",
        label: "Experiment notes",
        locator: "https://example.com/experiment",
        pageCount: null,
        sections: [
          {
            text: "The controlled experiment reached 62% checkout completion.",
            locator: "https://example.com/experiment",
          },
        ],
      },
    ],
    { idFactory: () => `source-${++sourceId}` },
  );
  const urlChunk = corpus.chunks.find((chunk) => chunk.kind === "url");
  assert.ok(urlChunk);

  const generated = draft();
  generated.decision.background = claim(
    "The controlled experiment reached 62% checkout completion.",
    "supported",
    "The controlled experiment reached 62% checkout completion.",
    urlChunk.chunkId,
  );
  generated.metric.baselinePct = 62;
  generated.metric.baselineEvidenceQuote =
    "The controlled experiment reached 62% checkout completion.";
  generated.metric.baselineSourceChunkId = urlChunk.chunkId;

  const result = materializeModelDecisionReport(generated, corpus, {
    idFactory: () => "claim",
  });
  assert.equal(result.report.decision.background[0].status, "sourced");
  assert.deepEqual(result.report.decision.background[0].sourceChunkIds, [urlChunk.chunkId]);
  assert.equal(result.metricProjection.baselinePct, 62);

  generated.decision.background.evidenceSourceChunkId = INITIAL_PROMPT_SOURCE_ID;
  generated.metric.baselineSourceChunkId = INITIAL_PROMPT_SOURCE_ID;
  const forged = materializeModelDecisionReport(generated, corpus, {
    idFactory: () => "forged",
  });
  assert.notEqual(forged.report.decision.background[0].status, "sourced");
  assert.equal(forged.metricProjection.baselinePct, null);
});

test("quotes cannot span chunks and numeric claims are checked across the whole corpus", () => {
  const corpus = createReportSourceCorpus(PROMPT, [
    {
      kind: "pdf",
      label: "Study.pdf",
      locator: "Study.pdf",
      pageCount: 2,
      sections: [
        { text: "Page one ends with conversion", locator: "Page 1" },
        { text: "rose to 61% in the cohort.", locator: "Page 2" },
      ],
    },
  ]);
  const pdfChunks = corpus.chunks.filter((chunk) => chunk.kind === "pdf");
  assert.equal(pdfChunks.length, 2);

  const generated = draft();
  generated.decision.background = claim(
    "Conversion rose to 61%.",
    "supported",
    "conversion rose to 61%",
    pdfChunks[0].chunkId,
  );
  generated.supportingEvidence.metricMechanism = claim(
    "The supplied study reported 61%.",
    "inference",
  );
  const result = materializeModelDecisionReport(generated, corpus, {
    idFactory: () => "bounded",
  });
  assert.notEqual(result.report.decision.background[0].status, "sourced");
  assert.equal(result.report.supportingEvidence.metricMechanism[0].status, "inferred");

  generated.supportingEvidence.metricMechanism = claim("The study reported 99%.", "inference");
  const invented = materializeModelDecisionReport(generated, corpus, {
    idFactory: () => "invented",
  });
  assert.equal(invented.report.supportingEvidence.metricMechanism[0].status, "missing");
});

test("invented metrics, customers, owners, and numeric claims are removed", () => {
  const generated = draft();
  generated.implementation.customers = [claim("Fortune 500 buyers", "inference")];
  generated.implementation.actions[0].owner = claim("Sam", "inference");
  generated.metric.baselinePct = 72;
  generated.metric.baselineEvidenceQuote = "Baseline completion is 40%";
  generated.supportingEvidence.metricMechanism = claim("Completion will improve 30%", "inference");

  const result = materializeModelDecisionReport(generated, PROMPT, { idFactory: () => "trusted" });
  assert.equal(result.report.implementation.customers[0].status, "missing");
  assert.equal(result.report.implementation.actions[0].owner, null);
  assert.equal(result.metricProjection.baselinePct, null);
  assert.equal(result.report.supportingEvidence.metricMechanism[0].status, "missing");
});

test("nine Decision Report adversarial claims cannot promote fabricated evidence to sourced", () => {
  const cases: Array<{
    name: string;
    mutate: (generated: ModelDecisionReportDraft) => void;
    read: (report: ReturnType<typeof materializeModelDecisionReport>["report"]) =>
      { status: string } | null;
  }> = [
    {
      name: "decision",
      mutate: (generated) => { generated.decision.decision = claim("Launch globally.", "supported", "The board approved a global launch."); },
      read: (report) => report.decision.decision[0],
    },
    {
      name: "background",
      mutate: (generated) => { generated.decision.background = claim("A prior test succeeded.", "supported", "The prior test increased revenue."); },
      read: (report) => report.decision.background[0],
    },
    {
      name: "problem",
      mutate: (generated) => { generated.decision.problem = claim("Support volume doubled.", "supported", "Support volume doubled last month."); },
      read: (report) => report.decision.problem[0],
    },
    {
      name: "proof claim",
      mutate: (generated) => { generated.supportingEvidence.factors = [claim("Research proves demand.", "supported", "Twelve interviews proved demand.")]; },
      read: (report) => report.supportingEvidence.factors[0],
    },
    {
      name: "metric mechanism",
      mutate: (generated) => { generated.supportingEvidence.metricMechanism = claim("Retention will rise.", "supported", "Retention rose in the experiment."); },
      read: (report) => report.supportingEvidence.metricMechanism[0],
    },
    {
      name: "action summary",
      mutate: (generated) => { generated.implementation.actionPlanSummary = claim("Legal approved the plan.", "supported", "Legal approved the implementation plan."); },
      read: (report) => report.implementation.actionPlanSummary[0],
    },
    {
      name: "owner",
      mutate: (generated) => { generated.implementation.actions[0].owner = claim("Rina", "supported", "Rina owns the launch."); },
      read: (report) => report.implementation.actions[0].owner,
    },
    {
      name: "customer",
      mutate: (generated) => { generated.implementation.customers = [claim("Acme Corp", "supported", "Acme Corp requested the feature.")]; },
      read: (report) => report.implementation.customers[0],
    },
    {
      name: "stakeholder",
      mutate: (generated) => { generated.implementation.stakeholders = [claim("Finance", "supported", "Finance signed off on the launch.")]; },
      read: (report) => report.implementation.stakeholders[0],
    },
  ];

  for (const scenario of cases) {
    const generated = draft();
    scenario.mutate(generated);
    const report = materializeModelDecisionReport(generated, PROMPT, {
      idFactory: () => scenario.name,
    }).report;
    assert.notEqual(scenario.read(report)?.status, "sourced", scenario.name);
  }
});

test("sparse model values materialize as explicit editable missing states", () => {
  const generated = draft();
  generated.decision.background = null;
  generated.supportingEvidence.factors = [];
  generated.supportingEvidence.metricMechanism = null;
  generated.implementation.actionPlanSummary = null;
  generated.implementation.actions[0].summary = null;
  generated.implementation.actions[0].owner = null;
  generated.implementation.customers = [];
  generated.implementation.stakeholders = [];
  generated.implementation.governance = null;

  const validation = validateModelDecisionReportDraft(generated);
  assert.equal(validation.success, true);

  const result = materializeModelDecisionReport(generated, PROMPT, { idFactory: () => "sparse" });
  assert.equal(result.report.decision.background[0].status, "missing");
  assert.equal(result.report.supportingEvidence.factors[0].status, "missing");
  assert.equal(result.report.supportingEvidence.metricMechanism[0].status, "missing");
  assert.equal(result.report.implementation.actionPlanSummary[0].status, "missing");
  assert.equal(result.report.implementation.actions[0].summary[0].status, "missing");
  assert.equal(result.report.implementation.actions[0].owner, null);
  assert.equal(result.report.implementation.customers[0].status, "missing");
  assert.equal(result.report.implementation.governance.dataClassification, null);
  assert.equal(result.report.implementation.governance.allowedDataSources[0].status, "missing");
});

test("safe fallback preserves the brief and leaves unsupported fields missing", () => {
  const fallback = createSafeFallbackReport(PROMPT, { idFactory: () => "safe" });
  assert.equal(fallback.report.decision.background[0].text, PROMPT);
  assert.equal(fallback.report.decision.background[0].status, "sourced");
  assert.equal(fallback.report.decision.decision[0].status, "missing");
  assert.equal(fallback.metricProjection.evidenceState, "missing");
  assert.deepEqual(fallback.report.sourceSummaries, fallback.sourceSummaries);
});

test("generation policy retries exactly once after a refusal", async () => {
  let attempts = 0;
  const result = await runWithSingleRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("provider refusal");
    return "accepted";
  }, 100);

  assert.equal(result.value, "accepted");
  assert.equal(result.attempts, 2);
  assert.equal(attempts, 2);
});

test("generation policy stops after two provider refusals", async () => {
  let attempts = 0;
  await assert.rejects(
    runWithSingleRetry(async () => {
      attempts += 1;
      throw new Error("provider refusal");
    }, 100),
    /provider refusal/,
  );
  assert.equal(attempts, 2);
});

test("generation policy times out and retries once", async () => {
  let attempts = 0;
  await assert.rejects(
    runWithSingleRetry(async () => {
      attempts += 1;
      await new Promise(() => undefined);
      return "never";
    }, 5),
    DecisionReportGenerationTimeoutError,
  );
  assert.equal(attempts, 2);
});

test("generation policy can stop after one non-retryable timeout", async () => {
  let attempts = 0;
  await assert.rejects(
    runWithSingleRetry(
      async () => {
        attempts += 1;
        await new Promise(() => undefined);
        return "never";
      },
      5,
      (error) => !(error instanceof DecisionReportGenerationTimeoutError),
    ),
    DecisionReportGenerationTimeoutError,
  );
  assert.equal(attempts, 1);
});
