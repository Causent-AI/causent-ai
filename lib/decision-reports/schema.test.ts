import assert from "node:assert/strict";
import { test } from "node:test";

import { GUMMY_ALPHA_GOLDEN_EXAMPLE } from "./fixtures/gummy-alpha.ts";
import { NORTHSTAR_SUPPORT_GOLDEN_EXAMPLE } from "./fixtures/northstar-support.ts";
import {
  cloneDecisionReport,
  flattenPortableRichText,
  getClaimPortableRichTextDocument,
  MAX_DECISION_REPORT_PRESENTATION_BYTES,
  MAX_PORTABLE_RICH_TEXT_CHARACTERS,
  MAX_PORTABLE_RICH_TEXT_DEPTH,
  MAX_PORTABLE_RICH_TEXT_LINKS,
  MAX_PORTABLE_RICH_TEXT_NODES,
  MAX_PORTABLE_RICH_TEXT_URL_LENGTH,
  MAX_DECISION_REPORT_ACTIONS,
  MAX_DECISION_REPORT_SELECTED_METRICS,
  portableRichTextFromPlainText,
  resolveDecisionReportSelectedMetricIds,
  type PortableRichTextDocument,
  upgradeLegacyDecisionReportForEditing,
  validateDecisionReport,
  validateMetricProjection,
  validatePortableRichTextDocument,
} from "./schema.ts";

function validRichTextDocument(): PortableRichTextDocument {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Decision", marks: [{ type: "bold" }] }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Ship ", marks: [{ type: "italic" }] },
          {
            type: "text",
            text: "now",
            marks: [
              { type: "underline" },
              { type: "link", attrs: { href: "https://example.com/plan" } },
            ],
          },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }],
          },
          {
            type: "listItem",
            content: [{
              type: "paragraph",
              content: [
                { type: "text", text: "Second" },
                { type: "hardBreak" },
                { type: "text", text: "line" },
              ],
            }],
          },
        ],
      },
      {
        type: "orderedList",
        content: [{
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }],
        }],
      },
      {
        type: "blockquote",
        content: [{
          type: "heading",
          attrs: { level: 3 },
          content: [{
            type: "text",
            text: "A quote",
            marks: [{ type: "strike" }],
          }],
        }],
      },
    ],
  };
}

test("Gummy Alpha is a valid versioned Decision Report fixture", () => {
  const result = validateDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  assert.equal(result.success, true, result.success ? undefined : result.errors.join("\n"));
});

test("Northstar Support is a complete activation-ready Decision Report fixture", () => {
  const example = NORTHSTAR_SUPPORT_GOLDEN_EXAMPLE;
  const result = validateDecisionReport(example.report);
  assert.equal(result.success, true, result.success ? undefined : result.errors.join("\n"));
  assert.equal(validateMetricProjection(example.metricProjection).success, true);
  assert.equal(example.report.implementation.actions.length, 3);
  assert.ok(
    example.report.implementation.actions.every(
      (action) => action.owner?.text.trim() && action.estimatedTime && action.estimatedCost,
    ),
  );
  assert.deepEqual(
    example.report.activationDraft?.selectedActionSourceItemIds,
    example.report.implementation.actions.map((action) => action.sourceItemId),
  );
  assert.ok(example.report.activationDraft?.primaryLeverActionSourceItemId);
  assert.equal(example.report.activationDraft?.prediction.magnitudePctMean, 37.5);
  assert.equal(example.metricProjection.metricName, "First-week Setup Completion");
  assert.equal(example.metricProjection.evidenceState, "prompt_supplied");
});

test("sourced claims require a source chunk", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  report.decision.decision[0].sourceChunkIds = [];

  const result = validateDecisionReport(report);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.errors.some((error) => error.includes("has no source chunk")));
  }
});

test("missing claims cannot silently contain text", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  report.implementation.stakeholders[0].text = "Product lead";

  const result = validateDecisionReport(report);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.errors.some((error) => error.includes("is missing but contains text")));
  }
});

test("action plans allow 25 draft actions but reject a 26th", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const template = structuredClone(report.implementation.actions[0]);
  while (report.implementation.actions.length < MAX_DECISION_REPORT_ACTIONS) {
    const index = report.implementation.actions.length + 1;
    report.implementation.actions.push({
      ...structuredClone(template),
      sourceItemId: `action-${index}`,
      summary: [{
        ...structuredClone(template.summary[0]),
        id: `action-${index}-summary`,
      }],
      owner: null,
    });
  }

  assert.equal(validateDecisionReport(report).success, true);

  report.implementation.actions.push({
    ...structuredClone(template),
    sourceItemId: "action-26",
    summary: [{
      ...structuredClone(template.summary[0]),
      id: "action-26-summary",
    }],
    owner: null,
  });

  const result = validateDecisionReport(report);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.errors.some((error) => error.includes("cannot exceed 25")));
  }
});

test("action execution metadata is bounded and validated", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  report.implementation.actions[0].priority = 3;
  report.implementation.actions[0].tags = ["Measurement", "Experiment"];
  report.implementation.actions[0].skills = ["Analytics engineering"];
  report.implementation.actions[0].estimatedTime = "2–3 days";
  report.implementation.actions[0].estimatedCost = "Internal team";
  assert.equal(validateDecisionReport(report).success, true);

  report.implementation.actions[0].tags = Array.from({ length: 6 }, (_, index) => `tag-${index}`);
  const invalid = validateDecisionReport(report);
  assert.equal(invalid.success, false);
  if (!invalid.success) {
    assert.ok(invalid.errors.some((error) => error.includes("tags")));
  }
});

test("activation draft intent is optional, bounded, and tied to report actions", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const actionId = report.implementation.actions[0].sourceItemId;
  report.activationDraft = {
    confirmedMetricId: "ca5e0000-0000-0000-0000-000000000073",
    selectedActionSourceItemIds: [actionId],
    primaryLeverActionSourceItemId: actionId,
    prediction: {
      direction: "NEGATIVE",
      magnitudePctMean: 12.5,
      resolutionDate: "2099-12-15",
    },
  };
  assert.equal(validateDecisionReport(report).success, true);

  report.activationDraft.selectedActionSourceItemIds = ["forged-action"];
  const forgedAction = validateDecisionReport(report);
  assert.equal(forgedAction.success, false);
  if (!forgedAction.success) {
    assert.ok(
      forgedAction.errors.some((error) =>
        error.includes("unique report action IDs"),
      ),
    );
  }

  report.activationDraft.selectedActionSourceItemIds = [actionId];
  report.activationDraft.primaryLeverActionSourceItemId = actionId;
  report.activationDraft.confirmedMetricId = "not-a-metric";
  report.activationDraft.prediction.resolutionDate = "2099-02-31";
  const invalidFields = validateDecisionReport(report);
  assert.equal(invalidFields.success, false);
  if (!invalidFields.success) {
    assert.ok(invalidFields.errors.some((error) => error.includes("must be null or a UUID")));
    assert.ok(invalidFields.errors.some((error) => error.includes("valid YYYY-MM-DD date")));
  }
});

test("legacy activation drafts resolve the confirmed metric as their selected set", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const primaryMetricId = "ca5e0000-0000-0000-0000-000000000073";
  const actionId = report.implementation.actions[0].sourceItemId;
  report.activationDraft = {
    confirmedMetricId: primaryMetricId,
    selectedActionSourceItemIds: [actionId],
    primaryLeverActionSourceItemId: actionId,
    prediction: {
      direction: "POSITIVE",
      magnitudePctMean: null,
      resolutionDate: null,
    },
  };
  report.implementation.actions[0].metricId = primaryMetricId;

  assert.deepEqual(
    resolveDecisionReportSelectedMetricIds(report.activationDraft),
    [primaryMetricId],
  );
  assert.equal(validateDecisionReport(report).success, true);

  const explicit = {
    ...report.activationDraft,
    selectedMetricIds: [primaryMetricId],
  };
  const resolved = resolveDecisionReportSelectedMetricIds(explicit);
  resolved.push("ca5e0000-0000-0000-0000-000000000074");
  assert.deepEqual(explicit.selectedMetricIds, [primaryMetricId]);
});

test("selected metrics and action assignments are UUID-bounded and internally consistent", () => {
  const metricIds = Array.from(
    { length: MAX_DECISION_REPORT_SELECTED_METRICS + 1 },
    (_, index) => `ca5e0000-0000-0000-0000-${String(index + 73).padStart(12, "0")}`,
  );
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const actionId = report.implementation.actions[0].sourceItemId;
  report.activationDraft = {
    confirmedMetricId: metricIds[0],
    selectedMetricIds: metricIds.slice(0, MAX_DECISION_REPORT_SELECTED_METRICS),
    selectedActionSourceItemIds: [actionId],
    primaryLeverActionSourceItemId: actionId,
    prediction: {
      direction: "POSITIVE",
      magnitudePctMean: null,
      resolutionDate: null,
    },
  };
  report.implementation.actions[0].metricId = metricIds[4];
  assert.equal(validateDecisionReport(report).success, true);

  const assertSelectionError = (
    mutate: (candidate: typeof report) => void,
    expected: RegExp,
  ) => {
    const candidate = cloneDecisionReport(report);
    mutate(candidate);
    const result = validateDecisionReport(candidate);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.match(result.errors.join("\n"), expected);
    }
  };

  assertSelectionError(
    (candidate) => {
      candidate.activationDraft!.selectedMetricIds = metricIds;
    },
    /up to 5 unique metric UUIDs/,
  );
  assertSelectionError(
    (candidate) => {
      candidate.activationDraft!.selectedMetricIds = [metricIds[0], metricIds[0]];
    },
    /up to 5 unique metric UUIDs/,
  );
  assertSelectionError(
    (candidate) => {
      candidate.activationDraft!.selectedMetricIds = ["not-a-metric"];
    },
    /up to 5 unique metric UUIDs/,
  );
  assertSelectionError(
    (candidate) => {
      candidate.activationDraft!.selectedMetricIds = metricIds.slice(1, 5);
    },
    /confirmedMetricId must be one of/,
  );
  assertSelectionError(
    (candidate) => {
      candidate.implementation.actions[0].metricId = metricIds[5];
    },
    /metricId must be one of activationDraft.selectedMetricIds/,
  );
  assertSelectionError(
    (candidate) => {
      candidate.implementation.actions[0].metricId = "not-a-metric";
    },
    /metricId must be null, absent, or a UUID/,
  );

  const noDraft = cloneDecisionReport(report);
  delete noDraft.activationDraft;
  const missingSelection = validateDecisionReport(noDraft);
  assert.equal(missingSelection.success, false);
  if (!missingSelection.success) {
    assert.match(
      missingSelection.errors.join("\n"),
      /metricId requires activationDraft.selectedMetricIds/,
    );
  }
});

test("supporting action monitoring context is optional, bounded, and non-causal", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const action = report.implementation.actions[1];
  action.monitoringExpectedDirection = "DECREASE";
  action.monitoringCheckDate = "2099-06-30";
  assert.equal(validateDecisionReport(report).success, true);

  action.monitoringExpectedDirection = "POSITIVE" as "DECREASE";
  action.monitoringCheckDate = "2099-02-31";
  const invalid = validateDecisionReport(report);
  assert.equal(invalid.success, false);
  if (!invalid.success) {
    assert.match(invalid.errors.join("\n"), /monitoringExpectedDirection/);
    assert.match(invalid.errors.join("\n"), /monitoringCheckDate/);
  }
});

test("supporting evidence cannot exceed three proof claims", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  report.supportingEvidence.factors.push(structuredClone(report.supportingEvidence.factors[0]));

  const result = validateDecisionReport(report);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.errors.some((error) => error.includes("supportingEvidence.factors cannot exceed 3")));
  }
});

test("sanitized source metadata persists the chunk-to-source mapping", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  assert.equal(validateDecisionReport(report).success, true);

  report.sourceSummaries![0].chunks[0].chunkId = "unrelated-chunk";
  const forged = validateDecisionReport(report);
  assert.equal(forged.success, false);
  if (!forged.success) {
    assert.ok(
      forged.errors.some((error) =>
        error.includes("sourced claims must reference a persisted source chunk"),
      ),
    );
  }
});

test("new reports cannot omit or forge durable source provenance", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  delete report.sourceSummaries;
  const missing = validateDecisionReport(report);
  assert.equal(missing.success, false);
  if (!missing.success) {
    assert.ok(missing.errors.some((error) => error.includes("sourceSummaries is required")));
  }

  const forged = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  forged.sourceSummaries![0].chunks[0].contentSha256 = "not-a-digest";
  const invalidDigest = validateDecisionReport(forged);
  assert.equal(invalidDigest.success, false);
});

test("legacy v1 snapshots remain readable without claiming v2 provenance", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  report.schemaVersion = 1;
  delete report.sourceSummaries;
  assert.equal(validateDecisionReport(report).success, true);

  const upgraded = upgradeLegacyDecisionReportForEditing(report);
  assert.equal(upgraded.schemaVersion, 2);
  assert.deepEqual(upgraded.sourceSummaries, []);
  assert.equal(upgraded.decision.decision[0].status, "user_confirmed");
  assert.deepEqual(upgraded.decision.decision[0].sourceChunkIds, []);
  assert.equal(validateDecisionReport(upgraded).success, true);
});

test("plain text normalizes to a valid portable document without changing content", () => {
  for (const text of ["", "One paragraph", "First\nSecond", "First\n\nThird\n"]) {
    const document = portableRichTextFromPlainText(text);
    assert.equal(flattenPortableRichText(document), text);
    assert.equal(validatePortableRichTextDocument(document).success, true);
  }
});

test("the portable rich-text allowlist preserves deterministic plain text", () => {
  const document = validRichTextDocument();
  assert.equal(validatePortableRichTextDocument(document).success, true);
  assert.equal(
    flattenPortableRichText(document),
    "Decision\nShip now\nFirst\nSecond\nline\nOne\nA quote",
  );
});

test("report presentation is optional, claim-keyed, and backward compatible", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const claim = report.decision.decision[0];
  const document = portableRichTextFromPlainText(claim.text);
  document.content[0] = {
    type: "paragraph",
    content: [{ type: "text", text: claim.text, marks: [{ type: "bold" }] }],
  };
  report.presentation = {
    version: 1,
    claimDocuments: { [claim.id]: document },
  };
  assert.equal(validateDecisionReport(report).success, true);

  const resolved = getClaimPortableRichTextDocument(report, claim);
  assert.deepEqual(resolved, document);
  resolved.content = [{ type: "paragraph" }];
  assert.deepEqual(report.presentation.claimDocuments[claim.id], document);

  const legacy = cloneDecisionReport(report);
  legacy.schemaVersion = 1;
  delete legacy.sourceSummaries;
  assert.equal(validateDecisionReport(legacy).success, true);

  delete report.presentation;
  assert.deepEqual(
    getClaimPortableRichTextDocument(report, claim),
    portableRichTextFromPlainText(claim.text),
  );
  assert.equal(validateDecisionReport(report).success, true);
});

test("report presentation rejects orphaned and text-divergent claim documents", () => {
  const orphaned = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  orphaned.presentation = {
    version: 1,
    claimDocuments: {
      "unknown-claim": portableRichTextFromPlainText("Unknown"),
    },
  };
  const orphanedResult = validateDecisionReport(orphaned);
  assert.equal(orphanedResult.success, false);
  if (!orphanedResult.success) {
    assert.ok(orphanedResult.errors.some((error) => error.includes("existing claim ID")));
  }

  const divergent = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const claim = divergent.decision.decision[0];
  divergent.presentation = {
    version: 1,
    claimDocuments: {
      [claim.id]: portableRichTextFromPlainText(`${claim.text} changed`),
    },
  };
  const divergentResult = validateDecisionReport(divergent);
  assert.equal(divergentResult.success, false);
  if (!divergentResult.success) {
    assert.ok(divergentResult.errors.some((error) => error.includes("must equal Claim.text")));
  }
});

test("report presentation rejects unknown versions and fields", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report) as unknown as {
    presentation?: unknown;
  };
  report.presentation = {
    version: 2,
    claimDocuments: {},
    html: "<script>alert(1)</script>",
  };
  const result = validateDecisionReport(report);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.errors.some((error) => error.includes("presentation.version")));
    assert.ok(result.errors.some((error) => error.includes("unsupported fields")));
  }
});

test("portable rich text rejects unknown structure, attributes, marks, and list shapes", () => {
  const invalidDocuments: unknown[] = [
    { type: "doc", content: [{ type: "codeBlock" }] },
    {
      type: "doc",
      content: [{ type: "heading", attrs: { level: 1 }, content: [] }],
    },
    {
      type: "doc",
      content: [{ type: "paragraph", align: "center", content: [] }],
    },
    {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "Code", marks: [{ type: "code" }] }],
      }],
    },
    {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "Repeated",
          marks: [{ type: "bold" }, { type: "bold" }],
        }],
      }],
    },
    {
      type: "doc",
      content: [{
        type: "bulletList",
        content: [{
          type: "listItem",
          content: [{ type: "heading", attrs: { level: 2 }, content: [] }],
        }],
      }],
    },
    { type: "doc", content: [] },
  ];

  invalidDocuments.forEach((document) => {
    assert.equal(validatePortableRichTextDocument(document).success, false);
  });
});

test("portable rich text accepts only bounded absolute HTTP and HTTPS links", () => {
  const linkedDocument = (href: string): unknown => ({
    type: "doc",
    content: [{
      type: "paragraph",
      content: [{
        type: "text",
        text: "Link",
        marks: [{ type: "link", attrs: { href } }],
      }],
    }],
  });

  assert.equal(validatePortableRichTextDocument(linkedDocument("http://example.com")).success, true);
  assert.equal(validatePortableRichTextDocument(linkedDocument("https://example.com/a?q=1#b")).success, true);
  for (const href of [
    "javascript:alert(1)",
    "mailto:team@example.com",
    "/relative",
    "https://user:secret@example.com",
    "https://example.com/white space",
    `https://example.com/${"a".repeat(MAX_PORTABLE_RICH_TEXT_URL_LENGTH)}`,
  ]) {
    assert.equal(validatePortableRichTextDocument(linkedDocument(href)).success, false);
  }

  const extraLinkAttributes = linkedDocument("https://example.com") as {
    content: Array<{ content: Array<{ marks: Array<Record<string, unknown>> }> }>;
  };
  extraLinkAttributes.content[0].content[0].marks[0].attrs = {
    href: "https://example.com",
    target: "_blank",
  };
  assert.equal(validatePortableRichTextDocument(extraLinkAttributes).success, false);
});

test("portable rich-text node, depth, character, and link limits fail closed", () => {
  const tooManyNodes = {
    type: "doc",
    content: Array.from(
      { length: MAX_PORTABLE_RICH_TEXT_NODES },
      () => ({ type: "paragraph" }),
    ),
  };
  assert.equal(validatePortableRichTextDocument(tooManyNodes).success, false);

  let nested: unknown = {
    type: "paragraph",
    content: [{ type: "text", text: "Deep" }],
  };
  for (let index = 0; index <= MAX_PORTABLE_RICH_TEXT_DEPTH; index += 1) {
    nested = { type: "blockquote", content: [nested] };
  }
  assert.equal(
    validatePortableRichTextDocument({ type: "doc", content: [nested] }).success,
    false,
  );

  const tooMuchText = portableRichTextFromPlainText(
    "x".repeat(MAX_PORTABLE_RICH_TEXT_CHARACTERS + 1),
  );
  assert.equal(validatePortableRichTextDocument(tooMuchText).success, false);

  const tooManyLinks = {
    type: "doc",
    content: [{
      type: "paragraph",
      content: Array.from({ length: MAX_PORTABLE_RICH_TEXT_LINKS + 1 }, (_, index) => ({
        type: "text",
        text: `${index}`,
        marks: [{ type: "link", attrs: { href: `https://example.com/${index}` } }],
      })),
    }],
  };
  assert.equal(validatePortableRichTextDocument(tooManyLinks).success, false);
});

test("report presentation has a total serialized-size ceiling below the snapshot limit", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const claims = [
    report.decision.decision[0],
    report.decision.background[0],
    report.decision.problem[0],
    report.supportingEvidence.factors[0],
    report.supportingEvidence.metricMechanism[0],
    report.implementation.actionPlanSummary[0],
  ];
  const perDocumentLength = Math.ceil(
    MAX_DECISION_REPORT_PRESENTATION_BYTES / claims.length,
  ) + 100;
  assert.ok(perDocumentLength < MAX_PORTABLE_RICH_TEXT_CHARACTERS);

  const claimDocuments: Record<string, PortableRichTextDocument> = {};
  claims.forEach((claim, index) => {
    claim.text = `${index}`.repeat(perDocumentLength);
    claim.status = "user_confirmed";
    claim.sourceChunkIds = [];
    claimDocuments[claim.id] = portableRichTextFromPlainText(claim.text);
  });
  report.presentation = { version: 1, claimDocuments };

  const result = validateDecisionReport(report);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.errors.some((error) => error.includes("serialized bytes")));
  }
});

test("metric projections validate bounded percentages and evidence state", () => {
  const valid = validateMetricProjection(GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection);
  assert.equal(valid.success, true);

  const invalid = validateMetricProjection({
    ...GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection,
    predictedPct: 140,
    evidenceState: "observed",
  });
  assert.equal(invalid.success, false);
  if (!invalid.success) {
    assert.ok(invalid.errors.some((error) => error.includes("predictedPct")));
    assert.ok(invalid.errors.some((error) => error.includes("evidenceState")));
  }
});
