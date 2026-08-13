import type {
  Claim,
  DecisionReportActivationDraft,
  DecisionReportV1,
  DraftAction,
} from "./schema.ts";
import {
  cloneDecisionReport,
  MAX_DECISION_REPORT_ACTIONS,
  validateDecisionReport,
} from "./schema.ts";

export const REQUIRED_REPORT_FIELD_COUNT = 5;

export type DecisionReportGapKind =
  | "background"
  | "problem"
  | "decision"
  | "action_plan_summary"
  | "action";

export type DecisionReportGap = {
  kind: DecisionReportGapKind;
  question: string;
  targetId: string;
  claimId: string | null;
};

type DataClassification =
  DecisionReportV1["implementation"]["governance"]["dataClassification"];

export type ReportEditCommandV1 =
  | { type: "edit_report_title"; title: string }
  | {
      type: "edit_activation_draft";
      activationDraft: DecisionReportActivationDraft;
    }
  | { type: "replace_claim_text"; claimId: string; text: string }
  | {
      type: "add_supporting_evidence";
      claimId: string;
      text: string;
    }
  | { type: "add_customer"; claimId: string; text: string }
  | { type: "add_stakeholder"; claimId: string; text: string }
  | { type: "edit_action_title"; sourceItemId: string; title: string }
  | { type: "edit_action_summary"; sourceItemId: string; text: string }
  | { type: "edit_action_owner"; sourceItemId: string; text: string }
  | {
      type: "edit_action_execution";
      sourceItemId: string;
      priority: 1 | 2 | 3;
      tags: string[];
      skills: string[];
      estimatedTime: string;
      estimatedCost: string;
    }
  | {
      type: "add_action";
      sourceItemId: string;
      title: string;
      summary: string;
    }
  | { type: "remove_action"; sourceItemId: string }
  | { type: "set_data_classification"; value: DataClassification };

export type ReportEditResult =
  | { ok: true; report: DecisionReportV1 }
  | { ok: false; error: string };

export type GapAnswerCommandResult =
  | { ok: true; command: ReportEditCommandV1 }
  | { ok: false; error: string };

function reportClaims(report: DecisionReportV1): Claim[] {
  return [
    ...report.decision.decision,
    ...report.decision.background,
    ...report.decision.problem,
    ...report.supportingEvidence.factors,
    ...report.supportingEvidence.metricMechanism,
    ...report.implementation.actionPlanSummary,
    ...report.implementation.customers,
    ...report.implementation.stakeholders,
    ...report.implementation.governance.allowedDataSources,
    ...report.implementation.governance.approvedModelNotes,
    ...report.implementation.actions.flatMap((action) => [
      ...action.summary,
      ...(action.owner ? [action.owner] : []),
    ]),
  ];
}

function claimIsComplete(claim: Claim | undefined): boolean {
  return Boolean(
    claim && claim.status !== "missing" && claim.text.trim() !== "",
  );
}

function claimGap(
  kind: Exclude<DecisionReportGapKind, "action">,
  question: string,
  claims: Claim[],
): DecisionReportGap {
  const claim = claims.find((candidate) => !claimIsComplete(candidate)) ?? claims[0];
  return {
    kind,
    question,
    claimId: claim?.id ?? null,
    targetId: claim ? `claim-${claim.id}` : "report-top",
  };
}

export function scanDecisionReportGaps(
  report: DecisionReportV1,
): DecisionReportGap[] {
  const gaps: DecisionReportGap[] = [];

  if (!report.decision.background.some(claimIsComplete)) {
    gaps.push(
      claimGap(
        "background",
        "What context should someone know about this challenge?",
        report.decision.background,
      ),
    );
  }

  if (!report.decision.problem.some(claimIsComplete)) {
    gaps.push(
      claimGap(
        "problem",
        "What is the specific problem to solve?",
        report.decision.problem,
      ),
    );
  }

  if (!report.decision.decision.some(claimIsComplete)) {
    gaps.push(
      claimGap(
        "decision",
        "What decision or change should move this forward?",
        report.decision.decision,
      ),
    );
  }

  if (!report.implementation.actionPlanSummary.some(claimIsComplete)) {
    gaps.push(
      claimGap(
        "action_plan_summary",
        "How will you put this decision into action?",
        report.implementation.actionPlanSummary,
      ),
    );
  }

  const firstUsableAction = report.implementation.actions.find(
    (action) => action.title.trim() !== "",
  );
  if (!firstUsableAction) {
    gaps.push({
      kind: "action",
      question: "What is the first concrete action?",
      claimId: null,
      targetId: "report-actions-empty",
    });
  }

  return gaps;
}

function editError(error: string): ReportEditResult {
  return { ok: false, error };
}

function userClaim(id: string, text: string): Claim {
  return {
    id,
    text,
    status: text.trim() === "" ? "missing" : "user_confirmed",
    sourceChunkIds: [],
  };
}

function validDataClassification(value: unknown): value is DataClassification {
  return [null, "private", "organization", "public"].includes(
    value as string | null,
  );
}

function findAction(
  report: DecisionReportV1,
  sourceItemId: string,
): DraftAction | undefined {
  return report.implementation.actions.find(
    (item) => item.sourceItemId === sourceItemId,
  );
}

function appendAudienceClaim(
  report: DecisionReportV1,
  claims: Claim[],
  claimId: string,
  text: string,
  label: "Customer" | "Stakeholder",
): ReportEditResult | null {
  if (claims.length >= 3) {
    return editError(`${label} list cannot exceed 3 items.`);
  }
  if (claimId.trim() === "") {
    return editError(`${label} claim ID cannot be empty.`);
  }
  if (reportClaims(report).some((claim) => claim.id === claimId)) {
    return editError(`Claim already exists: ${claimId}`);
  }
  claims.push(userClaim(claimId, text));
  return null;
}

export function applyReportEditCommand(
  report: DecisionReportV1,
  command: ReportEditCommandV1,
): ReportEditResult {
  const next = cloneDecisionReport(report);

  switch (command.type) {
    case "edit_report_title": {
      if (command.title.trim() === "") {
        return editError("Report title cannot be empty.");
      }
      next.title = command.title;
      break;
    }
    case "edit_activation_draft": {
      next.activationDraft = structuredClone(command.activationDraft);
      break;
    }
    case "replace_claim_text": {
      const target = reportClaims(next).find(
        (claim) => claim.id === command.claimId,
      );
      if (!target) return editError(`Unknown claim: ${command.claimId}`);

      target.text = command.text;
      target.status = command.text.trim() === "" ? "missing" : "user_confirmed";
      target.sourceChunkIds = [];
      break;
    }
    case "add_supporting_evidence": {
      if (next.supportingEvidence.factors.length >= 3) {
        return editError("Supporting evidence cannot exceed 3 items.");
      }
      if (command.claimId.trim() === "") {
        return editError("Supporting evidence claim ID cannot be empty.");
      }
      if (reportClaims(next).some((claim) => claim.id === command.claimId)) {
        return editError(`Claim already exists: ${command.claimId}`);
      }
      next.supportingEvidence.factors.push(
        userClaim(command.claimId, command.text),
      );
      break;
    }
    case "add_customer": {
      const error = appendAudienceClaim(
        next,
        next.implementation.customers,
        command.claimId,
        command.text,
        "Customer",
      );
      if (error) return error;
      break;
    }
    case "add_stakeholder": {
      const error = appendAudienceClaim(
        next,
        next.implementation.stakeholders,
        command.claimId,
        command.text,
        "Stakeholder",
      );
      if (error) return error;
      break;
    }
    case "edit_action_title": {
      if (command.title.trim() === "") {
        return editError("Action title cannot be empty.");
      }
      const action = next.implementation.actions.find(
        (item) => item.sourceItemId === command.sourceItemId,
      );
      if (!action) return editError(`Unknown action: ${command.sourceItemId}`);
      action.title = command.title;
      break;
    }
    case "edit_action_summary": {
      const action = next.implementation.actions.find(
        (item) => item.sourceItemId === command.sourceItemId,
      );
      if (!action) return editError(`Unknown action: ${command.sourceItemId}`);
      const existing = action.summary[0];
      action.summary = [
        userClaim(existing?.id ?? `${command.sourceItemId}-summary`, command.text),
      ];
      break;
    }
    case "edit_action_owner": {
      const action = findAction(next, command.sourceItemId);
      if (!action) return editError(`Unknown action: ${command.sourceItemId}`);
      action.owner = command.text.trim()
        ? userClaim(
            action.owner?.id ?? `${command.sourceItemId}-owner`,
            command.text,
          )
        : null;
      break;
    }
    case "edit_action_execution": {
      const action = findAction(next, command.sourceItemId);
      if (!action) return editError(`Unknown action: ${command.sourceItemId}`);
      action.priority = command.priority;
      action.tags = command.tags.map((tag) => tag.trim()).filter(Boolean);
      action.skills = command.skills.map((skill) => skill.trim()).filter(Boolean);
      action.estimatedTime = command.estimatedTime;
      action.estimatedCost = command.estimatedCost;
      break;
    }
    case "add_action": {
      if (next.implementation.actions.length >= MAX_DECISION_REPORT_ACTIONS) {
        return editError(
          `Action plan cannot exceed ${MAX_DECISION_REPORT_ACTIONS} actions.`,
        );
      }
      if (command.sourceItemId.trim() === "") {
        return editError("Action ID cannot be empty.");
      }
      if (command.title.trim() === "") {
        return editError("Action title cannot be empty.");
      }
      if (
        next.implementation.actions.some(
          (action) => action.sourceItemId === command.sourceItemId,
        )
      ) {
        return editError(`Action already exists: ${command.sourceItemId}`);
      }
      const reservedIds = new Set(reportClaims(next).map((claim) => claim.id));
      if (
        reservedIds.has(`${command.sourceItemId}-summary`) ||
        reservedIds.has(`${command.sourceItemId}-owner`)
      ) {
        return editError(`Action ID conflicts with an existing claim: ${command.sourceItemId}`);
      }

      next.implementation.actions.push({
        sourceItemId: command.sourceItemId,
        title: command.title,
        summary: [
          userClaim(`${command.sourceItemId}-summary`, command.summary),
        ],
        owner: null,
        priority: 2,
        tags: [],
        skills: [],
        estimatedTime: "",
        estimatedCost: "",
      });
      break;
    }
    case "remove_action": {
      const actionIndex = next.implementation.actions.findIndex(
        (action) => action.sourceItemId === command.sourceItemId,
      );
      if (actionIndex < 0) {
        return editError(`Unknown action: ${command.sourceItemId}`);
      }
      next.implementation.actions.splice(actionIndex, 1);
      if (next.activationDraft) {
        next.activationDraft.selectedActionSourceItemIds =
          next.activationDraft.selectedActionSourceItemIds.filter(
            (selectedId) => selectedId !== command.sourceItemId,
          );
        if (
          next.activationDraft.primaryLeverActionSourceItemId ===
          command.sourceItemId
        ) {
          next.activationDraft.primaryLeverActionSourceItemId = null;
        }
      }
      break;
    }
    case "set_data_classification": {
      if (!validDataClassification(command.value)) {
        return editError("Data classification is invalid.");
      }
      next.implementation.governance.dataClassification = command.value;
      break;
    }
  }

  const validation = validateDecisionReport(next);
  if (!validation.success) {
    return editError(
      `Edit would make the report invalid: ${validation.errors.join("; ")}`,
    );
  }
  return { ok: true, report: next };
}

export function createGapAnswerCommand(
  gap: DecisionReportGap,
  answer: string,
  newActionId?: string,
): GapAnswerCommandResult {
  if (answer.trim() === "") {
    return { ok: false, error: "Answer cannot be empty." };
  }

  if (gap.kind === "action") {
    if (!newActionId) {
      return { ok: false, error: "A new action ID is required." };
    }
    return {
      ok: true,
      command: {
        type: "add_action",
        sourceItemId: newActionId,
        title: answer,
        summary: "",
      },
    };
  }

  if (!gap.claimId) {
    return { ok: false, error: "This report field has no editable claim." };
  }
  return {
    ok: true,
    command: {
      type: "replace_claim_text",
      claimId: gap.claimId,
      text: answer,
    },
  };
}
