import {
  getClaimPortableRichTextDocument,
  validatePortableRichTextDocument,
  type Claim,
  type DecisionReportV1,
  type PortableRichTextDocument,
} from "./schema.ts";

export const DECISION_REPORT_CANVAS_IDS = ["decision", "action_plan"] as const;

export type DecisionReportCanvasId =
  (typeof DECISION_REPORT_CANVAS_IDS)[number];

export type DecisionReportCanvasSectionKind =
  | "background"
  | "problem"
  | "decision"
  | "evidence"
  | "action_plan_summary"
  | "core_metrics"
  | "action";

export type DecisionReportCanvasClaim = {
  claimId: string;
  document: PortableRichTextDocument;
};

/**
 * Application-owned structure for one composite report editor. Typed controls
 * can key off a section without becoming arbitrary rich-text attributes.
 */
export type DecisionReportCanvasSection = {
  sectionId: string;
  kind: DecisionReportCanvasSectionKind;
  title: string;
  optional: boolean;
  actionSourceItemId?: string;
  claims: DecisionReportCanvasClaim[];
};

export type DecisionReportCanvas = {
  canvasId: DecisionReportCanvasId;
  sections: DecisionReportCanvasSection[];
};

export type DecisionReportCanvasSplitResult =
  | { ok: true; documents: DecisionReportCanvasClaim[] }
  | { ok: false; error: string };

function canvasClaims(
  report: DecisionReportV1,
  claims: Claim[],
): DecisionReportCanvasClaim[] {
  return claims.map((claim) => ({
    claimId: claim.id,
    document: getClaimPortableRichTextDocument(report, claim),
  }));
}

export function composeDecisionReportCanvas(
  report: DecisionReportV1,
  canvasId: DecisionReportCanvasId,
): DecisionReportCanvas {
  if (canvasId === "decision") {
    return {
      canvasId,
      sections: [
        {
          sectionId: "decision:background",
          kind: "background",
          title: "Background",
          optional: false,
          claims: canvasClaims(report, report.decision.background),
        },
        {
          sectionId: "decision:problem",
          kind: "problem",
          title: "Problem",
          optional: false,
          claims: canvasClaims(report, report.decision.problem),
        },
        {
          sectionId: "decision:decision",
          kind: "decision",
          title: "Decision",
          optional: false,
          claims: canvasClaims(report, report.decision.decision),
        },
        {
          sectionId: "decision:evidence",
          kind: "evidence",
          title: "Evidence",
          optional: true,
          claims: canvasClaims(report, report.supportingEvidence.factors),
        },
      ],
    };
  }

  return {
    canvasId,
    sections: [
      {
        sectionId: "action-plan:summary",
        kind: "action_plan_summary",
        title: "Action Plan Summary",
        optional: false,
        claims: canvasClaims(report, report.implementation.actionPlanSummary),
      },
      {
        sectionId: "action-plan:core-metrics",
        kind: "core_metrics",
        title: "Core Metrics",
        optional: false,
        claims: [],
      },
      ...report.implementation.actions.map((action) => ({
        sectionId: `action-plan:action:${action.sourceItemId}`,
        kind: "action" as const,
        title: action.title,
        optional: false,
        actionSourceItemId: action.sourceItemId,
        claims: canvasClaims(report, action.summary),
      })),
    ],
  };
}

export function composeDecisionReportCanvases(
  report: DecisionReportV1,
): Record<DecisionReportCanvasId, DecisionReportCanvas> {
  return {
    decision: composeDecisionReportCanvas(report, "decision"),
    action_plan: composeDecisionReportCanvas(report, "action_plan"),
  };
}

export function decisionReportCanvasClaimIds(
  canvas: DecisionReportCanvas,
): string[] {
  return canvas.sections.flatMap((section) =>
    section.claims.map((claim) => claim.claimId),
  );
}

/** Stable structural identity; content and editable action titles are excluded. */
export function decisionReportCanvasSectionIdentity(
  section: DecisionReportCanvasSection,
): string {
  return JSON.stringify([
    section.sectionId,
    section.kind,
    section.optional,
    section.actionSourceItemId ?? null,
    section.claims.map((claim) => claim.claimId),
  ]);
}

/** Stable structural identity suitable for deciding whether an editor must rebuild. */
export function decisionReportCanvasIdentity(
  canvas: DecisionReportCanvas,
): string {
  return JSON.stringify([
    canvas.canvasId,
    canvas.sections.map(decisionReportCanvasSectionIdentity),
  ]);
}

function validateCanvasStructure(canvas: DecisionReportCanvas): string | null {
  if (canvas.canvasId === "decision") {
    const expected = [
      ["decision:background", "background", false],
      ["decision:problem", "problem", false],
      ["decision:decision", "decision", false],
      ["decision:evidence", "evidence", true],
    ] as const;
    if (
      canvas.sections.length !== expected.length ||
      canvas.sections.some((section, index) => {
        const identity = expected[index];
        return !identity ||
          section.sectionId !== identity[0] ||
          section.kind !== identity[1] ||
          section.optional !== identity[2];
      })
    ) {
      return "Decision canvas structure is invalid.";
    }
    return null;
  }

  const [summary, metrics, ...actions] = canvas.sections;
  if (
    !summary ||
    summary.sectionId !== "action-plan:summary" ||
    summary.kind !== "action_plan_summary" ||
    summary.optional ||
    !metrics ||
    metrics.sectionId !== "action-plan:core-metrics" ||
    metrics.kind !== "core_metrics" ||
    metrics.optional ||
    metrics.claims.length !== 0 ||
    actions.some(
      (section) =>
        section.kind !== "action" ||
        section.optional ||
        !section.actionSourceItemId ||
        section.sectionId !==
          `action-plan:action:${section.actionSourceItemId}`,
    )
  ) {
    return "Action-plan canvas structure is invalid.";
  }
  return null;
}

/**
 * Extract validated claim documents from a composite editor payload. Section
 * layout stays runtime-only; claim-keyed portable documents remain canonical.
 */
export function splitDecisionReportCanvas(
  canvas: DecisionReportCanvas,
): DecisionReportCanvasSplitResult {
  if (!DECISION_REPORT_CANVAS_IDS.includes(canvas.canvasId)) {
    return { ok: false, error: "Canvas identity is invalid." };
  }
  const structureError = validateCanvasStructure(canvas);
  if (structureError) return { ok: false, error: structureError };

  const sectionIds = new Set<string>();
  const claimIds = new Set<string>();
  const documents: DecisionReportCanvasClaim[] = [];
  for (const section of canvas.sections) {
    if (!section.sectionId || sectionIds.has(section.sectionId)) {
      return { ok: false, error: "Canvas section identities must be unique." };
    }
    sectionIds.add(section.sectionId);

    if (section.kind === "action" && !section.actionSourceItemId) {
      return { ok: false, error: "Action sections require an action identity." };
    }
    if (section.kind !== "action" && section.actionSourceItemId !== undefined) {
      return { ok: false, error: "Only action sections may carry an action identity." };
    }

    for (const claim of section.claims) {
      if (!claim.claimId || claimIds.has(claim.claimId)) {
        return { ok: false, error: "Canvas claim identities must be unique." };
      }
      const validation = validatePortableRichTextDocument(claim.document);
      if (!validation.success) {
        return {
          ok: false,
          error: `Canvas claim ${claim.claimId} is invalid: ${validation.errors.join("; ")}`,
        };
      }
      claimIds.add(claim.claimId);
      documents.push({
        claimId: claim.claimId,
        document: structuredClone(validation.data),
      });
    }
  }

  return { ok: true, documents };
}
