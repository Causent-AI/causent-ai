import type { SupabaseClient } from "@supabase/supabase-js";
import { UUID_PATTERN } from "../decision-reports/persistence.ts";
import type { MetricCsvObservation } from "./csv";

export type MetricImportSummary = {
  metricId: string;
  metricName: string;
  acceptedRows: number;
  rejectedRows: 0;
  startDate: string;
  endDate: string;
  insertedRows: number;
  updatedRows: number;
  existingObservationsUpdated: boolean;
};

export type MetricImportResult =
  | { ok: true; summary: MetricImportSummary }
  | { ok: false; code: "validation" | "forbidden" | "not_active" | "database"; error: string };

type ActiveReportRow = { report_id: string; active_metric_id: string; status: string };
type ImportRpcRow = {
  metric_id: string;
  metric_name: string;
  accepted_rows: number;
  inserted_rows: number;
  updated_rows: number;
  start_date: string;
  end_date: string;
};

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export async function loadActiveReportMetricIdentity(
  sb: SupabaseClient,
  scopeId: string,
): Promise<{ reportId: string; metricId: string } | null> {
  if (!validUuid(scopeId)) return null;
  const response = await sb
    .from("decision_reports")
    .select("report_id, active_metric_id, status")
    .eq("scope_id", scopeId)
    .eq("status", "active")
    .not("active_metric_id", "is", null)
    .order("activated_at", { ascending: false })
    .limit(1);
  if (response.error) throw response.error;
  const row = (response.data?.[0] ?? null) as ActiveReportRow | null;
  if (!row || row.status !== "active" || !validUuid(row.report_id) || !validUuid(row.active_metric_id)) return null;
  return { reportId: row.report_id, metricId: row.active_metric_id };
}

export async function importReportMetricObservations(
  sb: SupabaseClient,
  input: {
    scopeId: string;
    reportId: string;
    metricId: string;
    observations: MetricCsvObservation[];
    authoredBy: string | null;
  },
): Promise<MetricImportResult> {
  if (!validUuid(input.scopeId) || !validUuid(input.reportId) || !validUuid(input.metricId)) {
    return { ok: false, code: "validation", error: "The report metric identity is invalid." };
  }
  if (input.authoredBy !== null && !validUuid(input.authoredBy)) {
    return { ok: false, code: "validation", error: "The import author is invalid." };
  }
  if (input.observations.length < 1 || input.observations.length > 10_000) {
    return { ok: false, code: "validation", error: "Import one to 10,000 daily observations." };
  }
  const response = await sb.rpc("import_active_report_metric_csv_v1", {
    p_scope_id: input.scopeId,
    p_report_id: input.reportId,
    p_metric_id: input.metricId,
    p_observations: input.observations,
    p_authored_by: input.authoredBy,
  });
  if (response.error) {
    if (response.error.code === "42501") {
      return { ok: false, code: "forbidden", error: "The active report metric is unavailable in this workspace." };
    }
    if (response.error.code === "P0002") {
      return { ok: false, code: "not_active", error: "Activate a Decision Report before importing its metric CSV." };
    }
    if (response.error.code === "22023") {
      return { ok: false, code: "validation", error: response.error.message };
    }
    console.error("[metric-import] database import failed:", response.error);
    return { ok: false, code: "database", error: "The metric import could not be saved. Try again without changing the file." };
  }
  const rows = response.data as ImportRpcRow[] | null;
  const row = rows?.length === 1 ? rows[0] : null;
  if (!row || !validUuid(row.metric_id) || typeof row.metric_name !== "string"
      || !Number.isInteger(row.accepted_rows) || !Number.isInteger(row.inserted_rows)
      || !Number.isInteger(row.updated_rows) || typeof row.start_date !== "string"
      || typeof row.end_date !== "string") {
    return { ok: false, code: "database", error: "The database returned an invalid import summary." };
  }
  return {
    ok: true,
    summary: {
      metricId: row.metric_id,
      metricName: row.metric_name,
      acceptedRows: row.accepted_rows,
      rejectedRows: 0,
      startDate: row.start_date,
      endDate: row.end_date,
      insertedRows: row.inserted_rows,
      updatedRows: row.updated_rows,
      existingObservationsUpdated: row.updated_rows > 0,
    },
  };
}
