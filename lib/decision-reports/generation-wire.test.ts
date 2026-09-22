import assert from "node:assert/strict";
import { test } from "node:test";
import { generateText, Output, jsonSchema } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { decodeReportWire, REPORT_WIRE_SCHEMA } from "./generation-wire.ts";
import { materializeModelDecisionReport } from "./generation-contract.ts";

function entry(field: string, text: string, action = -1) {
  return { field, action, text, kind: "suggestion", evidenceQuote: "", evidenceSourceChunkId: "" };
}
function wire() {
  return {
    projectName: "Setup", title: "Simplify setup",
    claims: [entry("decision", "Test a shorter setup flow."), entry("actionTitle", "Simplify", 0), entry("actionSummary", "Build a smaller form.", 0)],
    dataClassification: "unspecified", metricName: "Completion", metricDefinition: "Completed divided by started setups",
    baselinePct: null as number | null, baselineEvidenceQuote: "", baselineSourceChunkId: "",
    predictedPct: null, predictedEvidenceQuote: "", predictedSourceChunkId: "",
  };
}

test("flat transport maps actions by index and preserves evidence through materialization", () => {
  const raw = wire();
  raw.claims.unshift(entry("actionSummary", "Review requests.", 1));
  raw.claims.push(entry("actionTitle", "Review support", 1));
  raw.claims.push({ ...entry("problem", "Customers leave setup."), kind: "supported", evidenceQuote: "Customers leave setup.", evidenceSourceChunkId: "initial-prompt" });
  const decoded = decodeReportWire(raw);
  assert.equal(decoded.success, true);
  if (!decoded.success) return;
  assert.deepEqual(decoded.value.implementation.actions.map((a) => a.title), ["Simplify", "Review support"]);
  assert.equal(decoded.value.decision.background, null);
  assert.equal(decoded.value.metric.baselinePct, null);
  const report = materializeModelDecisionReport(decoded.value, "Customers leave setup. We are considering a shorter form.");
  assert.equal(report.report.decision.problem[0].status, "sourced");
  assert.equal(report.report.implementation.actions[0].summary[0].status, "suggested");
  assert.equal(report.report.implementation.actions[0].owner, null);
});

test("transport never promotes invented sources or numeric claims", () => {
  const raw = wire();
  raw.claims.push({ ...entry("customer", "Acme"), kind: "supported", evidenceQuote: "Acme is a customer.", evidenceSourceChunkId: "invented" });
  raw.claims.push({ ...entry("actionOwner", "Alice", 0), kind: "supported", evidenceQuote: "Alice owns delivery.", evidenceSourceChunkId: "invented" });
  raw.baselinePct = 50;
  raw.baselineEvidenceQuote = "Baseline is 50%.";
  raw.baselineSourceChunkId = "invented";
  const decoded = decodeReportWire(raw);
  assert.equal(decoded.success, true);
  if (!decoded.success) return;
  const result = materializeModelDecisionReport(decoded.value, "Consider a shorter setup flow.");
  assert.equal(result.metricProjection.baselinePct, null);
  assert.equal(result.report.implementation.customers[0].status, "missing");
  assert.equal(result.report.implementation.actions[0].owner, null);
});

test("ambiguous, foreign and unbounded claim bindings fail closed", () => {
  const additions = [
    entry("decision", "Duplicate"), entry("actionTitle", "Duplicate", 0),
    entry("actionSummary", "Orphan", 1), entry("actionTitle", "Gap", 2),
    entry("actionTitle", "Overflow", 25), entry("problem", "Wrong binding", 0),
    entry("unknownField", "Unsupported"), entry("actionTitle", "Negative", -1),
  ];
  for (const addition of additions) {
    const raw = wire(); raw.claims.push(addition);
    assert.equal(decodeReportWire(raw).success, false, JSON.stringify(addition));
  }
  const raw = wire();
  raw.claims.push(...Array.from({ length: 4 }, () => entry("factor", "Too many")));
  assert.equal(decodeReportWire(raw).success, false);
  assert.equal(decodeReportWire({ ...wire(), scopeId: "foreign" }).success, false);
  assert.equal(decodeReportWire({ ...wire(), claims: [ { ...entry("decision", "X"), sourceChunkIds: ["forged"] } ] }).success, false);
});

test("provider output still obeys canonical value bounds", () => {
  const raw = wire(); raw.claims[0].text = "x".repeat(501);
  assert.equal(decodeReportWire(raw).success, false);
  raw.claims[0].text = "A short decision";
  raw.baselinePct = 101;
  assert.equal(decodeReportWire(raw).success, false);
  assert.equal(decodeReportWire({ claims: [] }).success, false);
  assert.equal(decodeReportWire({ ...wire(), claims: [] }).success, true);
});

test("paragraph rewrites with empty unrelated labels use explicit missing defaults", () => {
  const raw = {
    ...wire(), projectName: "", title: " ", metricName: "", metricDefinition: "",
    claims: [entry("decision", "Some customers leave before completing setup.")],
  };
  const decoded = decodeReportWire(raw);
  assert.equal(decoded.success, true);
  if (!decoded.success) return;
  assert.equal(decoded.value.projectName, "New project");
  assert.equal(decoded.value.title, "Decision Report draft");
  assert.equal(decoded.value.metric.name, "Core metric needs confirmation");
  assert.equal(decoded.value.metric.definition, "Define how this metric is calculated.");
  assert.equal(decoded.value.metric.baselinePct, null);
  assert.equal(decoded.value.decision.decision?.text, raw.claims[0].text);
  assert.deepEqual(decoded.value.implementation.actions, []);
  assert.equal(decodeReportWire({ ...raw, projectName: null }).success, false);
  assert.equal(decodeReportWire({ ...raw, title: "x".repeat(181) }).success, false);
});

test("provider grammar has only one repeated claim object", () => {
  const schemaText = JSON.stringify(REPORT_WIRE_SCHEMA);
  assert.equal((schemaText.match(/"type":"object"/g) ?? []).length, 2);
  assert.equal((schemaText.match(/"type":"array"/g) ?? []).length, 1);
  assert.ok(schemaText.length < 2000);
  assert.doesNotMatch(schemaText, /maxLength|maxItems|minimum|maximum/);
});

test("AI SDK validates and transforms the compact response into the persisted contract", async () => {
  const raw = wire();
  const result = await generateText({
    model: new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: JSON.stringify(raw) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
        warnings: [],
      }),
    }),
    prompt: "Synthetic response conversion test; no network calls.",
    output: Output.object({ schema: jsonSchema(REPORT_WIRE_SCHEMA, { validate: decodeReportWire }) }),
  });
  const expected = decodeReportWire(raw);
  assert.equal(expected.success, true);
  if (expected.success) assert.deepEqual(result.output, expected.value);
});
