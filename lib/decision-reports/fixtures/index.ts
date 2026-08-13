import type { DecisionReportGoldenExample } from "@/lib/decision-reports/schema";

import { GUMMY_ALPHA_GOLDEN_EXAMPLE } from "./gummy-alpha.ts";
import { NORTHSTAR_SUPPORT_GOLDEN_EXAMPLE } from "./northstar-support.ts";

export const DECISION_REPORT_GOLDEN_EXAMPLES = [
  GUMMY_ALPHA_GOLDEN_EXAMPLE,
  NORTHSTAR_SUPPORT_GOLDEN_EXAMPLE,
] as const satisfies readonly DecisionReportGoldenExample[];

export function findDecisionReportGoldenExample(
  prompt: string,
): DecisionReportGoldenExample | null {
  return DECISION_REPORT_GOLDEN_EXAMPLES.find(
    (example) => example.initialPrompt === prompt.trim(),
  ) ?? null;
}
