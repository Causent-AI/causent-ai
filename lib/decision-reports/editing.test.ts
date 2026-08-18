import assert from "node:assert/strict";
import { test } from "node:test";

import { GUMMY_ALPHA_GOLDEN_EXAMPLE } from "./fixtures/gummy-alpha.ts";
import { createSafeFallbackReport } from "./generation-contract.ts";
import {
  applyReportEditCommand,
  createGapAnswerCommand,
  scanDecisionReportGaps,
} from "./editing.ts";
import {
  cloneDecisionReport,
  emptyDecisionReportActivationDraft,
  MAX_DECISION_REPORT_ACTIONS,
  portableRichTextFromPlainText,
  type PortableRichTextDocument,
  validateDecisionReport,
} from "./schema.ts";

function boldDocument(text: string): PortableRichTextDocument {
  const document = portableRichTextFromPlainText(text);
  const firstParagraph = document.content[0];
  if (
    firstParagraph?.type === "paragraph" &&
    firstParagraph.content?.[0]?.type === "text"
  ) {
    firstParagraph.content[0].marks = [{ type: "bold" }];
  }
  return document;
}

function fallbackReport() {
  let index = 0;
  return createSafeFallbackReport("We should launch a new product onboarding flow.", {
    idFactory: () => `test-${index++}`,
  }).report;
}

test("gap scanner uses the stable required-field order", () => {
  const report = fallbackReport();
  report.decision.background[0] = {
    ...report.decision.background[0],
    text: "",
    status: "missing",
    sourceChunkIds: [],
  };

  assert.deepEqual(
    scanDecisionReportGaps(report).map((gap) => gap.kind),
    [
      "background",
      "problem",
      "decision",
      "action_plan_summary",
      "action",
    ],
  );
});

test("optional missing fields do not block a complete report", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  report.supportingEvidence.factors = [{
    ...report.supportingEvidence.factors[0],
    text: "",
    status: "missing",
    sourceChunkIds: [],
  }];
  assert.equal(report.implementation.customers[0].status, "missing");
  assert.equal(report.implementation.stakeholders[0].status, "missing");
  assert.equal(report.implementation.governance.dataClassification, null);
  assert.deepEqual(scanDecisionReportGaps(report), []);
});

test("background is required even when supporting evidence is present", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  report.decision.background[0] = {
    ...report.decision.background[0],
    text: "",
    status: "missing",
    sourceChunkIds: [],
  };

  assert.deepEqual(
    scanDecisionReportGaps(report).map((gap) => gap.kind),
    ["background"],
  );
});

test("claim edits confirm user text, clear provenance, and preserve IDs", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const originalIds = structuredClone(report).decision.decision.map((claim) => claim.id);
  const result = applyReportEditCommand(report, {
    type: "replace_claim_text",
    claimId: "decision-primary",
    text: "Launch the assistant for a limited partner cohort.",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.report.decision.decision[0].status, "user_confirmed");
  assert.deepEqual(result.report.decision.decision[0].sourceChunkIds, []);
  assert.deepEqual(
    result.report.decision.decision.map((claim) => claim.id),
    originalIds,
  );
  assert.equal(validateDecisionReport(result.report).success, true);
});

test("formatting-only rich edits preserve sourced claim provenance", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const before = structuredClone(report);
  const claim = report.decision.decision[0];
  assert.equal(claim.status, "sourced");
  assert.ok(claim.sourceChunkIds.length > 0);

  const document = boldDocument(claim.text);
  const result = applyReportEditCommand(report, {
    type: "replace_claim_document",
    claimId: claim.id,
    document,
  });

  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  if (!result.ok) return;
  const editedClaim = result.report.decision.decision[0];
  assert.equal(editedClaim.text, claim.text);
  assert.equal(editedClaim.status, claim.status);
  assert.deepEqual(editedClaim.sourceChunkIds, claim.sourceChunkIds);
  assert.deepEqual(
    result.report.presentation?.claimDocuments[claim.id],
    document,
  );
  assert.equal(validateDecisionReport(result.report).success, true);
  assert.deepEqual(report, before);

  const undone = applyReportEditCommand(result.report, {
    type: "replace_claim_document",
    claimId: claim.id,
    document: portableRichTextFromPlainText(claim.text),
  });
  assert.equal(undone.ok, true, undone.ok ? undefined : undone.error);
  if (!undone.ok) return;
  assert.equal(undone.report.presentation, undefined);
  assert.equal(undone.report.decision.decision[0].status, claim.status);
  assert.deepEqual(
    undone.report.decision.decision[0].sourceChunkIds,
    claim.sourceChunkIds,
  );
});

test("text-changing rich edits confirm user text and clear provenance", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const claim = report.decision.decision[0];
  const replacement = "Launch the assistant with a limited partner cohort.";
  const document = boldDocument(replacement);
  const result = applyReportEditCommand(report, {
    type: "replace_claim_document",
    claimId: claim.id,
    document,
  });

  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  if (!result.ok) return;
  const editedClaim = result.report.decision.decision[0];
  assert.equal(editedClaim.id, claim.id);
  assert.equal(editedClaim.text, replacement);
  assert.equal(editedClaim.status, "user_confirmed");
  assert.deepEqual(editedClaim.sourceChunkIds, []);
  assert.deepEqual(
    result.report.presentation?.claimDocuments[claim.id],
    document,
  );
  assert.equal(validateDecisionReport(result.report).success, true);
});

test("rich edits use flattened missing semantics and reject invalid documents", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const claim = report.decision.problem[0];
  const blank = applyReportEditCommand(report, {
    type: "replace_claim_document",
    claimId: claim.id,
    document: portableRichTextFromPlainText(""),
  });
  assert.equal(blank.ok, true, blank.ok ? undefined : blank.error);
  if (blank.ok) {
    assert.equal(blank.report.decision.problem[0].status, "missing");
    assert.equal(blank.report.decision.problem[0].text, "");
    assert.deepEqual(blank.report.decision.problem[0].sourceChunkIds, []);
  }

  const before = structuredClone(report);
  const invalid = applyReportEditCommand(report, {
    type: "replace_claim_document",
    claimId: claim.id,
    document: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Unsafe" }] }],
      unsupported: true,
    } as PortableRichTextDocument,
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.error, /rich-text document is invalid/i);
  assert.deepEqual(report, before);
});

test("plain claim replacement removes only that claim's stale rich document", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const decision = report.decision.decision[0];
  const background = report.decision.background[0];
  const decisionFormatted = applyReportEditCommand(report, {
    type: "replace_claim_document",
    claimId: decision.id,
    document: boldDocument(decision.text),
  });
  assert.equal(decisionFormatted.ok, true);
  if (!decisionFormatted.ok) return;
  const backgroundFormatted = applyReportEditCommand(decisionFormatted.report, {
    type: "replace_claim_document",
    claimId: background.id,
    document: boldDocument(background.text),
  });
  assert.equal(backgroundFormatted.ok, true);
  if (!backgroundFormatted.ok) return;

  const plain = applyReportEditCommand(backgroundFormatted.report, {
    type: "replace_claim_text",
    claimId: decision.id,
    text: decision.text,
  });
  assert.equal(plain.ok, true, plain.ok ? undefined : plain.error);
  if (!plain.ok) return;
  assert.equal(plain.report.presentation?.claimDocuments[decision.id], undefined);
  assert.deepEqual(
    plain.report.presentation?.claimDocuments[background.id],
    boldDocument(background.text),
  );
  assert.equal(validateDecisionReport(plain.report).success, true);
});

test("composite canvas replacement is atomic and clears only semantically edited provenance", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const before = structuredClone(report);
  const background = report.decision.background[0];
  const decision = report.decision.decision[0];
  const problem = report.decision.problem[0];
  const replacement = `${decision.text} Start with a controlled cohort.`;

  const edited = applyReportEditCommand(report, {
    type: "replace_canvas_documents",
    canvasId: "decision",
    documents: [
      {
        claimId: background.id,
        document: boldDocument(background.text),
      },
      {
        claimId: decision.id,
        document: boldDocument(replacement),
      },
    ],
  });

  assert.equal(edited.ok, true, edited.ok ? undefined : edited.error);
  if (!edited.ok) return;
  assert.equal(edited.report.decision.background[0].status, background.status);
  assert.deepEqual(
    edited.report.decision.background[0].sourceChunkIds,
    background.sourceChunkIds,
  );
  assert.equal(edited.report.decision.decision[0].text, replacement);
  assert.equal(edited.report.decision.decision[0].status, "user_confirmed");
  assert.deepEqual(edited.report.decision.decision[0].sourceChunkIds, []);
  assert.deepEqual(edited.report.decision.problem[0], problem);
  assert.deepEqual(report, before);

  const invalidBatch = applyReportEditCommand(report, {
    type: "replace_canvas_documents",
    canvasId: "decision",
    documents: [
      {
        claimId: background.id,
        document: boldDocument("This update must not partially apply."),
      },
      {
        claimId: report.implementation.actions[0].summary[0].id,
        document: boldDocument("A cross-canvas update."),
      },
    ],
  });
  assert.equal(invalidBatch.ok, false);
  if (!invalidBatch.ok) assert.match(invalidBatch.error, /invalid or duplicate claim/);
  assert.deepEqual(report, before);
});

test("report title edits use the typed path and reject blank titles", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const before = structuredClone(report);
  const edited = applyReportEditCommand(report, {
    type: "edit_report_title",
    title: "A focused Gummy Alpha decision",
  });

  assert.equal(edited.ok, true);
  if (!edited.ok) return;
  assert.equal(edited.report.title, "A focused Gummy Alpha decision");
  assert.equal(validateDecisionReport(edited.report).success, true);

  const rejected = applyReportEditCommand(report, {
    type: "edit_report_title",
    title: "   ",
  });
  assert.deepEqual(rejected, {
    ok: false,
    error: "Report title cannot be empty.",
  });
  assert.deepEqual(report, before);
});

test("activation draft edits persist partial intent and action removal prunes it", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const firstActionId = report.implementation.actions[0].sourceItemId;
  const secondActionId = report.implementation.actions[1].sourceItemId;
  const edited = applyReportEditCommand(report, {
    type: "edit_activation_draft",
    activationDraft: {
      confirmedMetricId: "ca5e0000-0000-0000-0000-000000000073",
      selectedActionSourceItemIds: [firstActionId, secondActionId],
      primaryLeverActionSourceItemId: firstActionId,
      prediction: {
        direction: "POSITIVE",
        magnitudePctMean: null,
        resolutionDate: null,
      },
    },
  });

  assert.equal(edited.ok, true);
  if (!edited.ok) return;
  assert.deepEqual(edited.report.activationDraft, {
    confirmedMetricId: "ca5e0000-0000-0000-0000-000000000073",
    selectedActionSourceItemIds: [firstActionId, secondActionId],
    primaryLeverActionSourceItemId: firstActionId,
    prediction: {
      direction: "POSITIVE",
      magnitudePctMean: null,
      resolutionDate: null,
    },
  });

  const removed = applyReportEditCommand(edited.report, {
    type: "remove_action",
    sourceItemId: firstActionId,
  });
  assert.equal(removed.ok, true);
  if (!removed.ok) return;
  assert.deepEqual(
    removed.report.activationDraft?.selectedActionSourceItemIds,
    [secondActionId],
  );
  assert.equal(
    removed.report.activationDraft?.primaryLeverActionSourceItemId,
    null,
  );
  assert.equal(validateDecisionReport(removed.report).success, true);
});

test("supporting evidence can be added to a report with no factor claims", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  report.supportingEvidence.factors = [];

  const added = applyReportEditCommand(report, {
    type: "add_supporting_evidence",
    claimId: "user-evidence-stable-1",
    text: "",
  });

  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.deepEqual(added.report.supportingEvidence.factors, [
    {
      id: "user-evidence-stable-1",
      text: "",
      status: "missing",
      sourceChunkIds: [],
    },
  ]);

  const edited = applyReportEditCommand(added.report, {
    type: "replace_claim_text",
    claimId: "user-evidence-stable-1",
    text: "Partner interviews consistently showed the setup step was unclear.",
  });
  assert.equal(edited.ok, true);
  if (!edited.ok) return;
  assert.equal(
    edited.report.supportingEvidence.factors[0].id,
    "user-evidence-stable-1",
  );
  assert.equal(validateDecisionReport(edited.report).success, true);
});

test("supporting evidence can be safely removed with its presentation document", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const evidence = report.supportingEvidence.factors[0];
  const decision = report.decision.decision[0];
  const formattedEvidence = applyReportEditCommand(report, {
    type: "replace_claim_document",
    claimId: evidence.id,
    document: boldDocument(evidence.text),
  });
  assert.equal(formattedEvidence.ok, true);
  if (!formattedEvidence.ok) return;
  const formattedDecision = applyReportEditCommand(formattedEvidence.report, {
    type: "replace_claim_document",
    claimId: decision.id,
    document: boldDocument(decision.text),
  });
  assert.equal(formattedDecision.ok, true);
  if (!formattedDecision.ok) return;

  const removed = applyReportEditCommand(formattedDecision.report, {
    type: "remove_supporting_evidence",
    claimId: evidence.id,
  });
  assert.equal(removed.ok, true, removed.ok ? undefined : removed.error);
  if (!removed.ok) return;
  assert.equal(
    removed.report.supportingEvidence.factors.some((claim) => claim.id === evidence.id),
    false,
  );
  assert.equal(removed.report.presentation?.claimDocuments[evidence.id], undefined);
  assert.deepEqual(
    removed.report.presentation?.claimDocuments[decision.id],
    boldDocument(decision.text),
  );

  const beforeUnknown = structuredClone(removed.report);
  const unknown = applyReportEditCommand(removed.report, {
    type: "remove_supporting_evidence",
    claimId: evidence.id,
  });
  assert.equal(unknown.ok, false);
  assert.deepEqual(removed.report, beforeUnknown);
});

test("action metric edits require selected metrics and prune stale assignments", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const primaryMetricId = "ca5e0000-0000-0000-0000-000000000073";
  const secondaryMetricId = "ca5e0000-0000-0000-0000-000000000074";
  const unselectedMetricId = "ca5e0000-0000-0000-0000-000000000075";
  const actionId = report.implementation.actions[0].sourceItemId;
  report.activationDraft = {
    confirmedMetricId: primaryMetricId,
    selectedMetricIds: [primaryMetricId, secondaryMetricId],
    selectedActionSourceItemIds: report.implementation.actions.map(
      (action) => action.sourceItemId,
    ),
    primaryLeverActionSourceItemId: actionId,
    prediction: {
      direction: "POSITIVE",
      magnitudePctMean: null,
      resolutionDate: null,
    },
  };

  const assigned = applyReportEditCommand(report, {
    type: "edit_action_metric",
    sourceItemId: actionId,
    metricId: secondaryMetricId,
  });
  assert.equal(assigned.ok, true, assigned.ok ? undefined : assigned.error);
  if (!assigned.ok) return;
  assert.equal(assigned.report.implementation.actions[0].metricId, secondaryMetricId);

  const unselected = applyReportEditCommand(assigned.report, {
    type: "edit_action_metric",
    sourceItemId: actionId,
    metricId: unselectedMetricId,
  });
  assert.equal(unselected.ok, false);
  if (!unselected.ok) assert.match(unselected.error, /must be one of/);

  const pruned = applyReportEditCommand(assigned.report, {
    type: "edit_activation_draft",
    activationDraft: {
      ...assigned.report.activationDraft!,
      selectedMetricIds: [primaryMetricId],
    },
  });
  assert.equal(pruned.ok, true, pruned.ok ? undefined : pruned.error);
  if (!pruned.ok) return;
  assert.equal(pruned.report.implementation.actions[0].metricId, null);

  const cleared = applyReportEditCommand(assigned.report, {
    type: "edit_action_metric",
    sourceItemId: actionId,
    metricId: null,
  });
  assert.equal(cleared.ok, true, cleared.ok ? undefined : cleared.error);
  if (cleared.ok) assert.equal(cleared.report.implementation.actions[0].metricId, null);
});

test("new actions join the plan and inherit the confirmed primary metric", () => {
  const primaryMetricId = "ca5e0000-0000-0000-0000-000000000073";
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const existingActionId = report.implementation.actions[0].sourceItemId;
  report.activationDraft = {
    confirmedMetricId: primaryMetricId,
    selectedMetricIds: [primaryMetricId],
    selectedActionSourceItemIds: [existingActionId],
    primaryLeverActionSourceItemId: existingActionId,
    prediction: {
      direction: "POSITIVE",
      magnitudePctMean: null,
      resolutionDate: null,
    },
  };

  const added = applyReportEditCommand(report, {
    type: "add_action",
    sourceItemId: "user-action-selected",
    title: "Measure the controlled launch",
    summary: "Track the selected outcome during the launch.",
  });
  assert.equal(added.ok, true, added.ok ? undefined : added.error);
  if (!added.ok) return;
  assert.deepEqual(
    added.report.activationDraft?.selectedActionSourceItemIds,
    [existingActionId, "user-action-selected"],
  );
  assert.equal(
    added.report.implementation.actions.at(-1)?.metricId,
    primaryMetricId,
  );

  const legacy = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const legacyAdded = applyReportEditCommand(legacy, {
    type: "add_action",
    sourceItemId: "user-action-defaults",
    title: "Add a default-selected action",
    summary: "Keep every proposed action in the plan by default.",
  });
  assert.equal(legacyAdded.ok, true, legacyAdded.ok ? undefined : legacyAdded.error);
  if (!legacyAdded.ok) return;
  assert.deepEqual(
    legacyAdded.report.activationDraft?.selectedActionSourceItemIds,
    legacyAdded.report.implementation.actions.map((action) => action.sourceItemId),
  );
  assert.equal(legacyAdded.report.implementation.actions.at(-1)?.metricId, null);
});

test("adding claims and actions preserves existing presentation without creating orphan entries", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  report.supportingEvidence.factors = report.supportingEvidence.factors.slice(0, 2);
  const decision = report.decision.decision[0];
  const formatted = applyReportEditCommand(report, {
    type: "replace_claim_document",
    claimId: decision.id,
    document: boldDocument(decision.text),
  });
  assert.equal(formatted.ok, true);
  if (!formatted.ok) return;

  const evidenceId = "user-evidence-rich-contract";
  const withEvidence = applyReportEditCommand(formatted.report, {
    type: "add_supporting_evidence",
    claimId: evidenceId,
    text: "New supporting evidence",
  });
  assert.equal(withEvidence.ok, true, withEvidence.ok ? undefined : withEvidence.error);
  if (!withEvidence.ok) return;
  assert.equal(withEvidence.report.presentation?.claimDocuments[evidenceId], undefined);

  const actionId = "user-action-rich-contract";
  const withAction = applyReportEditCommand(withEvidence.report, {
    type: "add_action",
    sourceItemId: actionId,
    title: "Add a measured rollout",
    summary: "Instrument the rollout before launch.",
  });
  assert.equal(withAction.ok, true, withAction.ok ? undefined : withAction.error);
  if (!withAction.ok) return;
  assert.deepEqual(
    Object.keys(withAction.report.presentation?.claimDocuments ?? {}),
    [decision.id],
  );
  assert.equal(
    withAction.report.presentation?.claimDocuments[`${actionId}-summary`],
    undefined,
  );
  assert.equal(validateDecisionReport(withAction.report).success, true);
});

test("supporting evidence additions reject duplicate IDs and the fourth factor", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const duplicate = applyReportEditCommand(report, {
    type: "add_supporting_evidence",
    claimId: report.decision.decision[0].id,
    text: "Duplicate claim ID",
  });
  assert.equal(duplicate.ok, false);

  while (report.supportingEvidence.factors.length < 3) {
    const index = report.supportingEvidence.factors.length;
    report.supportingEvidence.factors.push({
      id: `evidence-${index}`,
      text: `Evidence ${index}`,
      status: "user_confirmed",
      sourceChunkIds: [],
    });
  }
  const capped = applyReportEditCommand(report, {
    type: "add_supporting_evidence",
    claimId: "evidence-four",
    text: "A fourth factor",
  });
  assert.equal(capped.ok, false);
});

test("customers and stakeholders can be added from empty optional lists", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  report.implementation.customers = [];
  report.implementation.stakeholders = [];

  const customer = applyReportEditCommand(report, {
    type: "add_customer",
    claimId: "user-customer-stable-1",
    text: "Trial customers",
  });
  assert.equal(customer.ok, true);
  if (!customer.ok) return;
  assert.deepEqual(customer.report.implementation.customers, [{
    id: "user-customer-stable-1",
    text: "Trial customers",
    status: "user_confirmed",
    sourceChunkIds: [],
  }]);

  const stakeholder = applyReportEditCommand(customer.report, {
    type: "add_stakeholder",
    claimId: "user-stakeholder-stable-1",
    text: "Growth lead",
  });
  assert.equal(stakeholder.ok, true);
  if (!stakeholder.ok) return;
  assert.deepEqual(stakeholder.report.implementation.stakeholders, [{
    id: "user-stakeholder-stable-1",
    text: "Growth lead",
    status: "user_confirmed",
    sourceChunkIds: [],
  }]);
  assert.equal(validateDecisionReport(stakeholder.report).success, true);
});

test("audience additions reject duplicate claim IDs and a fourth entry", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  report.implementation.customers = [];

  const duplicate = applyReportEditCommand(report, {
    type: "add_customer",
    claimId: report.decision.decision[0].id,
    text: "Duplicate",
  });
  assert.equal(duplicate.ok, false);

  for (let index = 1; index <= 3; index += 1) {
    report.implementation.customers.push({
      id: `customer-${index}`,
      text: `Customer ${index}`,
      status: "user_confirmed",
      sourceChunkIds: [],
    });
  }
  const capped = applyReportEditCommand(report, {
    type: "add_customer",
    claimId: "customer-4",
    text: "Customer 4",
  });
  assert.equal(capped.ok, false);
});

test("action commands preserve action and nested claim IDs", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const action = report.implementation.actions[0];
  const summaryId = action.summary[0].id;

  const summaryResult = applyReportEditCommand(report, {
    type: "edit_action_summary",
    sourceItemId: action.sourceItemId,
    text: "Instrument starts and completions before launch.",
  });
  assert.equal(summaryResult.ok, true);
  if (!summaryResult.ok) return;
  assert.equal(summaryResult.report.implementation.actions[0].sourceItemId, action.sourceItemId);
  assert.equal(summaryResult.report.implementation.actions[0].summary[0].id, summaryId);
  assert.equal(summaryResult.report.implementation.actions[0].summary[0].status, "user_confirmed");

  const ownerResult = applyReportEditCommand(summaryResult.report, {
    type: "edit_action_owner",
    sourceItemId: action.sourceItemId,
    text: "Growth engineering",
  });
  assert.equal(ownerResult.ok, true);
  if (!ownerResult.ok) return;
  const ownerId = ownerResult.report.implementation.actions[0].owner?.id;

  const revisedOwnerResult = applyReportEditCommand(ownerResult.report, {
    type: "edit_action_owner",
    sourceItemId: action.sourceItemId,
    text: "Product engineering",
  });
  assert.equal(revisedOwnerResult.ok, true);
  if (!revisedOwnerResult.ok) return;
  assert.equal(revisedOwnerResult.report.implementation.actions[0].owner?.id, ownerId);
});

test("plain action summary and owner edits remove stale rich documents", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const action = report.implementation.actions[0];
  const summary = action.summary[0];
  const formattedSummary = applyReportEditCommand(report, {
    type: "replace_claim_document",
    claimId: summary.id,
    document: boldDocument(summary.text),
  });
  assert.equal(formattedSummary.ok, true);
  if (!formattedSummary.ok) return;

  const plainSummary = applyReportEditCommand(formattedSummary.report, {
    type: "edit_action_summary",
    sourceItemId: action.sourceItemId,
    text: "A revised plain-text action summary.",
  });
  assert.equal(plainSummary.ok, true, plainSummary.ok ? undefined : plainSummary.error);
  if (!plainSummary.ok) return;
  assert.equal(plainSummary.report.presentation, undefined);

  const owned = applyReportEditCommand(plainSummary.report, {
    type: "edit_action_owner",
    sourceItemId: action.sourceItemId,
    text: "Growth engineering",
  });
  assert.equal(owned.ok, true);
  if (!owned.ok) return;
  const owner = owned.report.implementation.actions[0].owner;
  assert.ok(owner);
  const formattedOwner = applyReportEditCommand(owned.report, {
    type: "replace_claim_document",
    claimId: owner.id,
    document: boldDocument(owner.text),
  });
  assert.equal(formattedOwner.ok, true);
  if (!formattedOwner.ok) return;
  const clearedOwner = applyReportEditCommand(formattedOwner.report, {
    type: "edit_action_owner",
    sourceItemId: action.sourceItemId,
    text: "",
  });
  assert.equal(clearedOwner.ok, true, clearedOwner.ok ? undefined : clearedOwner.error);
  if (!clearedOwner.ok) return;
  assert.equal(clearedOwner.report.implementation.actions[0].owner, null);
  assert.equal(clearedOwner.report.presentation, undefined);
  assert.equal(validateDecisionReport(clearedOwner.report).success, true);
});

test("removing an action prunes all nested rich documents and preserves unrelated ones", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const action = report.implementation.actions[0];
  const decision = report.decision.decision[0];
  const withOwner = applyReportEditCommand(report, {
    type: "edit_action_owner",
    sourceItemId: action.sourceItemId,
    text: "Growth engineering",
  });
  assert.equal(withOwner.ok, true);
  if (!withOwner.ok) return;
  const owner = withOwner.report.implementation.actions[0].owner;
  assert.ok(owner);

  let current = withOwner.report;
  for (const claim of [decision, action.summary[0], owner]) {
    const formatted = applyReportEditCommand(current, {
      type: "replace_claim_document",
      claimId: claim.id,
      document: boldDocument(claim.text),
    });
    assert.equal(formatted.ok, true, formatted.ok ? undefined : formatted.error);
    if (!formatted.ok) return;
    current = formatted.report;
  }

  const removed = applyReportEditCommand(current, {
    type: "remove_action",
    sourceItemId: action.sourceItemId,
  });
  assert.equal(removed.ok, true, removed.ok ? undefined : removed.error);
  if (!removed.ok) return;
  assert.equal(
    removed.report.implementation.actions.some(
      (candidate) => candidate.sourceItemId === action.sourceItemId,
    ),
    false,
  );
  assert.deepEqual(
    Object.keys(removed.report.presentation?.claimDocuments ?? {}),
    [decision.id],
  );
  assert.equal(validateDecisionReport(removed.report).success, true);
});

test("action titles and data classification use the typed edit path", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const actionId = report.implementation.actions[0].sourceItemId;
  const titled = applyReportEditCommand(report, {
    type: "edit_action_title",
    sourceItemId: actionId,
    title: "Measure the assisted mixer funnel",
  });
  assert.equal(titled.ok, true);
  if (!titled.ok) return;

  const classified = applyReportEditCommand(titled.report, {
    type: "set_data_classification",
    value: "organization",
  });
  assert.equal(classified.ok, true);
  if (!classified.ok) return;
  assert.equal(
    classified.report.implementation.actions[0].title,
    "Measure the assisted mixer funnel",
  );
  assert.equal(
    classified.report.implementation.governance.dataClassification,
    "organization",
  );
  assert.equal(validateDecisionReport(classified.report).success, true);
});

test("action execution metadata uses the typed edit path", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const actionId = report.implementation.actions[0].sourceItemId;
  const edited = applyReportEditCommand(report, {
    type: "edit_action_execution",
    sourceItemId: actionId,
    priority: 3,
    tags: ["Measurement", "Launch"],
    skills: ["Analytics engineering"],
    estimatedTime: "3 days",
    estimatedCost: "Internal team",
  });
  assert.equal(edited.ok, true);
  if (!edited.ok) return;
  assert.deepEqual(edited.report.implementation.actions[0].tags, ["Measurement", "Launch"]);
  assert.deepEqual(edited.report.implementation.actions[0].skills, ["Analytics engineering"]);
  assert.equal(edited.report.implementation.actions[0].priority, 3);
  assert.equal(edited.report.implementation.actions[0].estimatedTime, "3 days");
  assert.equal(edited.report.implementation.actions[0].estimatedCost, "Internal team");
  assert.equal(validateDecisionReport(edited.report).success, true);
});

test("action execution estimates preserve internal and trailing spaces", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const actionId = report.implementation.actions[0].sourceItemId;
  const edited = applyReportEditCommand(report, {
    type: "edit_action_execution",
    sourceItemId: actionId,
    priority: 2,
    tags: [],
    skills: [],
    estimatedTime: "3  business days ",
    estimatedCost: "$5,000  internal ",
  });

  assert.equal(edited.ok, true);
  if (!edited.ok) return;
  assert.equal(
    edited.report.implementation.actions[0].estimatedTime,
    "3  business days ",
  );
  assert.equal(
    edited.report.implementation.actions[0].estimatedCost,
    "$5,000  internal ",
  );
  assert.equal(validateDecisionReport(edited.report).success, true);
});

test("invalid commands are rejected without mutating the input", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const before = structuredClone(report);
  const unknownClaim = applyReportEditCommand(report, {
    type: "replace_claim_text",
    claimId: "unknown",
    text: "New text",
  });
  const blankTitle = applyReportEditCommand(report, {
    type: "edit_action_title",
    sourceItemId: report.implementation.actions[0].sourceItemId,
    title: "  ",
  });
  const unknownRichClaim = applyReportEditCommand(report, {
    type: "replace_claim_document",
    claimId: "unknown",
    document: portableRichTextFromPlainText("New text"),
  });

  assert.equal(unknownClaim.ok, false);
  assert.equal(blankTitle.ok, false);
  assert.equal(unknownRichClaim.ok, false);
  assert.deepEqual(report, before);
});

test("adding and removing actions respects the 25-action draft ceiling", () => {
  const report = fallbackReport();
  const added = applyReportEditCommand(report, {
    type: "add_action",
    sourceItemId: "user-action-1",
    title: "Instrument the onboarding funnel",
    summary: "",
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.report.implementation.actions[0].sourceItemId, "user-action-1");
  assert.equal(added.report.implementation.actions[0].summary[0].id, "user-action-1-summary");
  assert.equal(added.report.implementation.actions[0].summary[0].status, "missing");

  let fullReport = added.report;
  for (let index = 2; index <= MAX_DECISION_REPORT_ACTIONS; index += 1) {
    const next = applyReportEditCommand(fullReport, {
      type: "add_action",
      sourceItemId: `user-action-${index}`,
      title: `Action ${index}`,
      summary: "",
    });
    assert.equal(next.ok, true);
    if (!next.ok) return;
    fullReport = next.report;
  }

  const capped = applyReportEditCommand(fullReport, {
    type: "add_action",
    sourceItemId: "user-action-26",
    title: "A twenty-sixth action",
    summary: "Not allowed",
  });
  assert.equal(capped.ok, false);

  const removed = applyReportEditCommand(fullReport, {
    type: "remove_action",
    sourceItemId: "user-action-25",
  });
  assert.equal(removed.ok, true);
  if (!removed.ok) return;
  assert.equal(removed.report.implementation.actions.length, 24);
  assert.equal(validateDecisionReport(removed.report).success, true);
});

test("supporting action monitoring context edits stay optional and non-causal", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const sourceItemId = report.implementation.actions[1].sourceItemId;
  const monitored = applyReportEditCommand(report, {
    type: "edit_action_monitoring",
    sourceItemId,
    expectedDirection: "DECREASE",
    checkDate: "2099-06-30",
  });
  assert.equal(monitored.ok, true);
  if (!monitored.ok) return;
  const action = monitored.report.implementation.actions.find(
    (item) => item.sourceItemId === sourceItemId,
  );
  assert.equal(action?.monitoringExpectedDirection, "DECREASE");
  assert.equal(action?.monitoringCheckDate, "2099-06-30");
  assert.equal(validateDecisionReport(monitored.report).success, true);

  const cleared = applyReportEditCommand(monitored.report, {
    type: "edit_action_monitoring",
    sourceItemId,
    expectedDirection: null,
    checkDate: null,
  });
  assert.equal(cleared.ok, true);
  if (!cleared.ok) return;
  const clearedAction = cleared.report.implementation.actions.find(
    (item) => item.sourceItemId === sourceItemId,
  );
  assert.equal(clearedAction?.monitoringExpectedDirection, null);
  assert.equal(clearedAction?.monitoringCheckDate, null);
});

test("registered primary actions reject a second monitoring hypothesis", () => {
  const report = cloneDecisionReport(GUMMY_ALPHA_GOLDEN_EXAMPLE.report);
  const sourceItemId = report.implementation.actions[0].sourceItemId;
  report.activationDraft = emptyDecisionReportActivationDraft();
  report.activationDraft.selectedActionSourceItemIds = report.implementation.actions.map(
    (action) => action.sourceItemId,
  );
  report.activationDraft.primaryLeverActionSourceItemId = sourceItemId;

  const rejected = applyReportEditCommand(report, {
    type: "edit_action_monitoring",
    sourceItemId,
    expectedDirection: "INCREASE",
    checkDate: "2099-06-30",
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.error, /supporting actions/);

  const cleared = applyReportEditCommand(report, {
    type: "edit_action_monitoring",
    sourceItemId,
    expectedDirection: null,
    checkDate: null,
  });
  assert.equal(cleared.ok, true);
});

test("focused answers and direct edits produce the same validated report", () => {
  const report = fallbackReport();
  const gap = scanDecisionReportGaps(report)[0];
  const answer = "Launch the new onboarding flow for partner teams.";
  const focusedCommand = createGapAnswerCommand(gap, answer);
  assert.equal(focusedCommand.ok, true);
  if (!focusedCommand.ok || !gap.claimId) return;

  const focused = applyReportEditCommand(report, focusedCommand.command);
  const direct = applyReportEditCommand(report, {
    type: "replace_claim_text",
    claimId: gap.claimId,
    text: answer,
  });

  assert.equal(focused.ok, true);
  assert.equal(direct.ok, true);
  if (!focused.ok || !direct.ok) return;
  assert.deepEqual(focused.report, direct.report);
  assert.equal(validateDecisionReport(focused.report).success, true);
});

test("answering all fallback gaps transitions the report to ready", () => {
  let report = fallbackReport();
  const answers = [
    "New teams do not know where to begin.",
    "Launch a new onboarding flow.",
    "Instrument, build, and test the new flow.",
    "Instrument onboarding starts and completions.",
  ];

  for (const answer of answers) {
    const gap = scanDecisionReportGaps(report)[0];
    const command = createGapAnswerCommand(
      gap,
      answer,
      gap.kind === "action" ? "user-action-ready" : undefined,
    );
    assert.equal(command.ok, true);
    if (!command.ok) return;
    const edited = applyReportEditCommand(report, command.command);
    assert.equal(edited.ok, true);
    if (!edited.ok) return;
    report = edited.report;
  }

  assert.deepEqual(scanDecisionReportGaps(report), []);
  assert.equal(validateDecisionReport(report).success, true);
});
