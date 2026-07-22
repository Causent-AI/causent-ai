"use server";

import { getSession } from "@/lib/auth/session";
import {
  saveDecisionReport,
  type DecisionReportPersistenceStatus,
} from "@/lib/decision-reports/persistence";
import {
  validateDecisionReport,
  validateMetricProjection,
  type DecisionReportV1,
  type MetricProjection,
} from "@/lib/decision-reports/schema";
import { getServerSupabase, isLocalDemo } from "@/lib/supabase-server";

export type SaveDecisionReportActionInput = {
  reportId: string | null;
  baseRevisionId: string | null;
  report: DecisionReportV1;
  metricProjection: MetricProjection;
};

export type SaveDecisionReportActionResult =
  | {
      ok: true;
      saved: {
        reportId: string;
        revisionId: string;
        status: DecisionReportPersistenceStatus;
        savedAt: string;
        reused: boolean;
      };
    }
  | {
      ok: false;
      code: "validation" | "conflict" | "forbidden" | "database";
      error: string;
      currentRevisionId?: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function saveDecisionReportAction(
  input: unknown,
): Promise<SaveDecisionReportActionResult> {
  if (!isRecord(input)) {
    return { ok: false, code: "validation", error: "Report save input is invalid." };
  }

  const reportValidation = validateDecisionReport(input.report);
  const projectionValidation = validateMetricProjection(input.metricProjection);
  if (!reportValidation.success || !projectionValidation.success) {
    return {
      ok: false,
      code: "validation",
      error: [
        ...(reportValidation.success ? [] : reportValidation.errors),
        ...(projectionValidation.success ? [] : projectionValidation.errors),
      ].join("; "),
    };
  }

  const reportId = input.reportId === null || typeof input.reportId === "string"
    ? input.reportId
    : undefined;
  const baseRevisionId = input.baseRevisionId === null || typeof input.baseRevisionId === "string"
    ? input.baseRevisionId
    : undefined;
  if (reportId === undefined || baseRevisionId === undefined) {
    return { ok: false, code: "validation", error: "Report revision address is invalid." };
  }

  const session = await getSession();
  if (!isLocalDemo() && !session.userId) {
    return { ok: false, code: "forbidden", error: "Sign in before saving this report." };
  }

  const result = await saveDecisionReport(
    await getServerSupabase(),
    session.workspaceId,
    {
      reportId,
      baseRevisionId,
      report: reportValidation.data,
      metricProjection: projectionValidation.data,
      authoredBy: session.userId,
    },
  );
  if (!result.ok) return result;

  return {
    ok: true,
    saved: {
      reportId: result.saved.reportId,
      revisionId: result.saved.revisionId,
      status: result.saved.status,
      savedAt: result.saved.savedAt,
      reused: result.reused,
    },
  };
}
