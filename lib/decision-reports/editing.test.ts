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
  MAX_DECISION_REPORT_ACTIONS,
  validateDecisionReport,
} from "./schema.ts";

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

  assert.equal(unknownClaim.ok, false);
  assert.equal(blankTitle.ok, false);
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
