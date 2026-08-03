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
import { recordDecisionReportTelemetry } from "@/lib/decision-reports/telemetry";

export type SaveDecisionReportActionInput = {
  reportId: string | null;
  baseRevisionId: string | null;
  sourceReceiptId: string | null;
  report: DecisionReportV1;
  metricProjection: MetricProjection;
  telemetry?: {
    sessionKey: string;
    msSinceStart: number;
    editCount: number;
    followUpCount: number;
    missingFieldCount: number;
  };
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

function readSaveTelemetry(value: unknown): SaveDecisionReportActionInput["telemetry"] | null {
  if (!isRecord(value)) return null;
  const fields = ["msSinceStart", "editCount", "followUpCount", "missingFieldCount"] as const;
  if (
    typeof value.sessionKey !== "string" ||
    fields.some((field) =>
      typeof value[field] !== "number" ||
      !Number.isSafeInteger(value[field]) ||
      value[field] < 0
    )
  ) return null;
  return {
    sessionKey: value.sessionKey,
    msSinceStart: value.msSinceStart as number,
    editCount: value.editCount as number,
    followUpCount: value.followUpCount as number,
    missingFieldCount: value.missingFieldCount as number,
  };
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
  const sourceReceiptId = input.sourceReceiptId === null || typeof input.sourceReceiptId === "string"
    ? input.sourceReceiptId
    : undefined;
  if (reportId === undefined || baseRevisionId === undefined || sourceReceiptId === undefined) {
    return { ok: false, code: "validation", error: "Report revision address is invalid." };
  }
  const telemetry = readSaveTelemetry(input.telemetry);

  const session = await getSession();
  if (!isLocalDemo() && !session.userId) {
    return { ok: false, code: "forbidden", error: "Sign in before saving this report." };
  }

  const sb = await getServerSupabase();
  const emit = async (eventType: "REPORT_SAVED" | "REPORT_SAVE_FAILED", reused?: boolean) => {
    if (!telemetry) return;
    await recordDecisionReportTelemetry({
      client: sb,
      scopeId: session.workspaceId,
      userId: session.userId,
    }, {
      sessionKey: telemetry.sessionKey,
      eventType,
      msSinceStart: telemetry.msSinceStart,
      meta: {
        editCount: telemetry.editCount,
        followUpCount: telemetry.followUpCount,
        missingFieldCount: telemetry.missingFieldCount,
        reused: reused ?? false,
      },
    });
  };

  const result = await saveDecisionReport(
    sb,
    session.workspaceId,
    {
      reportId,
      baseRevisionId,
      sourceReceiptId,
      report: reportValidation.data,
      metricProjection: projectionValidation.data,
      authoredBy: session.userId,
    },
  );
  if (!result.ok) {
    await emit("REPORT_SAVE_FAILED");
    return result;
  }
  await emit("REPORT_SAVED", result.reused);

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
