import { GUMMY_ALPHA_GOLDEN_EXAMPLE } from "./gummy-alpha.ts";
import { NORTHSTAR_SUPPORT_GOLDEN_EXAMPLE } from "./northstar-support.ts";
import { DEMO_SCOPE_ID, NORTHSTAR_SCOPE_ID } from "../../data/config.ts";

export type DecisionReportReviewExample = {
  id: DecisionReportReviewExampleId;
  workspaceId: typeof DEMO_SCOPE_ID | typeof NORTHSTAR_SCOPE_ID;
  project: string;
  label?: string;
  decision: string;
  badge: string;
  prompt: string;
};

export type DecisionReportReviewExampleId =
  | "gummy-alpha"
  | "northstar-support";

export const DECISION_REPORT_REVIEW_EXAMPLES: DecisionReportReviewExample[] = [
  {
    id: "gummy-alpha",
    workspaceId: DEMO_SCOPE_ID,
    project: "Gummy Alpha",
    decision: "Add contextual AI guidance to the product mixer",
    badge: "Editable example",
    prompt: GUMMY_ALPHA_GOLDEN_EXAMPLE.initialPrompt,
  },
  {
    id: "northstar-support",
    workspaceId: NORTHSTAR_SCOPE_ID,
    project: "Support Operations",
    label: "Northstar",
    decision: "Launch an in-product support assistant for setup questions",
    badge: "Full-plan example",
    prompt: NORTHSTAR_SUPPORT_GOLDEN_EXAMPLE.initialPrompt,
  },
];

export function findDecisionReportReviewExampleById(
  id: unknown,
): DecisionReportReviewExample | null {
  if (typeof id !== "string") return null;
  return DECISION_REPORT_REVIEW_EXAMPLES.find((example) => example.id === id) ?? null;
}

export type DecisionReportReviewExampleSelection =
  | { ok: true; example: DecisionReportReviewExample | null }
  | { ok: false; reason: "invalid_id" | "changed_input" };

export function validateDecisionReportReviewExampleSelection(input: {
  id: unknown;
  prompt: string;
  hasAdditionalSources: boolean;
}): DecisionReportReviewExampleSelection {
  if (input.id === null || input.id === undefined) {
    return { ok: true, example: null };
  }

  const example = findDecisionReportReviewExampleById(input.id);
  if (!example) return { ok: false, reason: "invalid_id" };
  if (input.prompt !== example.prompt || input.hasAdditionalSources) {
    return { ok: false, reason: "changed_input" };
  }
  return { ok: true, example };
}
