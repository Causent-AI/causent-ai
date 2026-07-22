import type {
  Claim,
  DecisionReportV1,
} from "./schema.ts";
import {
  cloneDecisionReport,
  validateDecisionReport,
} from "./schema.ts";

export const REQUIRED_REPORT_FIELD_COUNT = 6;

export type DecisionReportGapKind =
  | "decision"
  | "problem"
  | "proof"
  | "metric_mechanism"
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
  | { type: "replace_claim_text"; claimId: string; text: string }
  | { type: "edit_action_title"; sourceItemId: string; title: string }
  | { type: "edit_action_summary"; sourceItemId: string; text: string }
  | { type: "edit_action_owner"; sourceItemId: string; text: string }
  | {
      type: "add_action";
      sourceItemId: string;
      title: string;
      summary: string;
    }
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

function firstIncompleteClaim(claims: Claim[]): Claim | undefined {
  return claims.find((claim) => !claimIsComplete(claim)) ?? claims[0];
}

function claimGap(
  kind: Exclude<DecisionReportGapKind, "action">,
  question: string,
  claims: Claim[],
): DecisionReportGap {
  const claim = firstIncompleteClaim(claims);
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

  if (!report.decision.decision.some(claimIsComplete)) {
    gaps.push(
      claimGap(
        "decision",
        "What decision are you making?",
        report.decision.decision,
      ),
    );
  }

  if (!report.decision.problem.some(claimIsComplete)) {
    gaps.push(
      claimGap(
        "problem",
        "What problem or pain point does this solve?",
        report.decision.problem,
      ),
    );
  }

  if (!report.supportingEvidence.factors.some(claimIsComplete)) {
    gaps.push(
      claimGap(
        "proof",
        "What is the strongest evidence supporting this decision?",
        report.supportingEvidence.factors,
      ),
    );
  }

  if (!report.supportingEvidence.metricMechanism.some(claimIsComplete)) {
    gaps.push(
      claimGap(
        "metric_mechanism",
        "How should this decision affect the core metric?",
        report.supportingEvidence.metricMechanism,
      ),
    );
  }

  if (!report.implementation.actionPlanSummary.some(claimIsComplete)) {
    gaps.push(
      claimGap(
        "action_plan_summary",
        "What is the short plan to implement this decision?",
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

export function applyReportEditCommand(
  report: DecisionReportV1,
  command: ReportEditCommandV1,
): ReportEditResult {
  const next = cloneDecisionReport(report);

  switch (command.type) {
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
      const action = next.implementation.actions.find(
        (item) => item.sourceItemId === command.sourceItemId,
      );
      if (!action) return editError(`Unknown action: ${command.sourceItemId}`);
      action.owner = command.text.trim()
        ? userClaim(
            action.owner?.id ?? `${command.sourceItemId}-owner`,
            command.text,
          )
        : null;
      break;
    }
    case "add_action": {
      if (next.implementation.actions.length >= 3) {
        return editError("Action plan cannot exceed three actions.");
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
      });
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
