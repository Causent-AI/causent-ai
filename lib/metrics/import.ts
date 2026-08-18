import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { UUID_PATTERN } from "../decision-reports/persistence.ts";
import { METRIC_CSV_MAX_ROWS, type MetricCsvObservation } from "./csv.ts";

export const METRIC_CSV_CHUNK_ROWS = 250;

export type MetricImportReceipt = {
  importId: string;
  status: "complete";
  resumed: boolean;
};

export type MetricImportProgress = {
  importId: string;
  processedRows: number;
  totalRows: number;
};

export type MetricImportErrorCode = "validation" | "conflict" | "forbidden" | "not_active" | "database";

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
  receipt: MetricImportReceipt;
};

export type MetricImportResult =
  | { ok: true; summary: MetricImportSummary }
  | {
      ok: false;
      code: MetricImportErrorCode;
      error: string;
      progress?: MetricImportProgress;
    };

export type WorkspaceMetricImportSummary = {
  metricId: string;
  metricName: string;
  metricUnit: "count" | "percent" | "USD";
  created: boolean;
  acceptedRows: number;
  insertedRows: number;
  updatedRows: number;
  startDate: string;
  endDate: string;
  receipt: MetricImportReceipt;
};

export type WorkspaceMetricImportResult =
  | { ok: true; summary: WorkspaceMetricImportSummary }
  | {
      ok: false;
      code: MetricImportErrorCode;
      error: string;
      progress?: MetricImportProgress;
    };

export type WorkspaceCoreMetricSelectionResult =
  | {
      ok: true;
      metricId: string;
      isCore: boolean;
      coreMetricCount: number;
    }
  | { ok: false; code: "validation" | "forbidden" | "database"; error: string };

type WorkspaceReportPointerRow = { current_decision_report_series_id: string | null };
type ReportSeriesPointerRow = { current_active_report_id: string | null };
type ActiveReportRow = {
  report_id: string;
  series_id: string;
  active_metric_id: string;
  status: string;
  deleted_at: string | null;
};
type BeginImportRpcRow = {
  import_id: string;
  import_status: "received" | "in_progress" | "complete";
  metric_id: string;
  metric_name: string;
  metric_unit: "count" | "percent" | "USD" | null;
  metric_created: boolean;
  total_rows: number;
  processed_rows: number;
  inserted_rows: number;
  updated_rows: number;
  next_chunk_index: number;
  start_date: string;
  end_date: string;
  reused: boolean;
};

type ChunkImportRpcRow = Pick<
  BeginImportRpcRow,
  "import_id" | "import_status" | "processed_rows" | "total_rows" | "next_chunk_index" | "inserted_rows" | "updated_rows" | "reused"
>;

type FinalImportRpcRow = Omit<BeginImportRpcRow, "next_chunk_index">;

type RpcError = { code?: string; message: string };
type RpcResult = { data: unknown; error: RpcError | null };

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function validUnit(value: unknown): value is "count" | "percent" | "USD" {
  return value === "count" || value === "percent" || value === "USD";
}

function validMetricName(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.trim().length <= 120
    && !/[\u0000-\u001f]/.test(value);
}

type CoreMetricSelectionRpcRow = {
  selected_metric_id: string;
  is_core: boolean;
  core_metric_count: number;
};

const TRANSIENT_IMPORT_CODES = new Set(["40001", "40P01", "55P03"]);

function importDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function validIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function normalizeObservations(observations: MetricCsvObservation[]): MetricCsvObservation[] | null {
  if (observations.length < 1 || observations.length > METRIC_CSV_MAX_ROWS) return null;
  const normalized = observations.map((observation) => ({ ...observation }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const seen = new Set<string>();
  for (const observation of normalized) {
    if (!validIsoDate(observation.date)
        || !Number.isFinite(observation.value)
        || Math.abs(observation.value) > 1e15
        || seen.has(observation.date)) {
      return null;
    }
    seen.add(observation.date);
  }
  return normalized;
}

async function retryImportRpc(
  sb: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<RpcResult> {
  let response: RpcResult = { data: null, error: { message: "Import request did not run." } };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await sb.rpc(name, args) as unknown as RpcResult;
    if (!response.error || !TRANSIENT_IMPORT_CODES.has(response.error.code ?? "")) return response;
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  return response;
}

function singleRow<T>(response: RpcResult): T | null {
  return Array.isArray(response.data) && response.data.length === 1
    ? response.data[0] as T
    : null;
}

function validProgress(row: ChunkImportRpcRow): boolean {
  const statusIsValid = ["received", "in_progress", "complete"].includes(row.import_status);
  const countersAreValid = row.import_status === "complete"
    ? row.inserted_rows + row.updated_rows === row.processed_rows
    : row.inserted_rows === 0 && row.updated_rows === 0;
  return validUuid(row.import_id)
    && statusIsValid
    && Number.isInteger(row.processed_rows)
    && Number.isInteger(row.total_rows)
    && row.total_rows >= 1
    && row.total_rows <= METRIC_CSV_MAX_ROWS
    && row.processed_rows >= 0
    && row.processed_rows <= row.total_rows
    && Number.isInteger(row.next_chunk_index)
    && row.next_chunk_index >= 0
    && row.next_chunk_index === Math.ceil(row.processed_rows / METRIC_CSV_CHUNK_ROWS)
    && Number.isInteger(row.inserted_rows)
    && Number.isInteger(row.updated_rows)
    && row.inserted_rows >= 0
    && row.updated_rows >= 0
    && countersAreValid
    && typeof row.reused === "boolean";
}

function validBeginRow(row: BeginImportRpcRow | null): row is BeginImportRpcRow {
  return Boolean(row)
    && validProgress(row as BeginImportRpcRow)
    && validUuid(row!.metric_id)
    && typeof row!.metric_name === "string"
    && (row!.metric_unit === null || validUnit(row!.metric_unit))
    && typeof row!.metric_created === "boolean"
    && validIsoDate(row!.start_date)
    && validIsoDate(row!.end_date)
    && row!.start_date <= row!.end_date;
}

function validFinalRow(row: FinalImportRpcRow | null): row is FinalImportRpcRow {
  return Boolean(row)
    && validUuid(row!.import_id)
    && row!.import_status === "complete"
    && validUuid(row!.metric_id)
    && typeof row!.metric_name === "string"
    && (row!.metric_unit === null || validUnit(row!.metric_unit))
    && typeof row!.metric_created === "boolean"
    && Number.isInteger(row!.total_rows)
    && row!.processed_rows === row!.total_rows
    && Number.isInteger(row!.inserted_rows)
    && Number.isInteger(row!.updated_rows)
    && row!.inserted_rows + row!.updated_rows === row!.processed_rows
    && validIsoDate(row!.start_date)
    && validIsoDate(row!.end_date)
    && row!.start_date <= row!.end_date
    && typeof row!.reused === "boolean";
}

function progressOf(row: Pick<BeginImportRpcRow, "import_id" | "processed_rows" | "total_rows">): MetricImportProgress {
  return {
    importId: row.import_id,
    processedRows: row.processed_rows,
    totalRows: row.total_rows,
  };
}

function rpcFailure(
  error: RpcError,
  unavailableMessage: string,
  progress?: MetricImportProgress,
): {
  ok: false;
  code: MetricImportErrorCode;
  error: string;
  progress?: MetricImportProgress;
} {
  if (error.code === "42501") return { ok: false, code: "forbidden", error: unavailableMessage };
  if (error.code === "P0002") {
    return { ok: false, code: "not_active", error: "Activate a Decision Report before importing its metric CSV." };
  }
  if (error.code === "C4090") {
    return {
      ok: false,
      code: "conflict",
      error: error.message,
      ...(progress ? { progress } : {}),
    };
  }
  if (error.code === "22023") return { ok: false, code: "validation", error: error.message };
  return {
    ok: false,
    code: "database",
    error: progress
      ? `Import paused after ${progress.processedRows.toLocaleString("en-US")} of ${progress.totalRows.toLocaleString("en-US")} rows. Retry the same file to resume.`
      : "The metric import could not be saved. Retry the same file.",
    ...(progress ? { progress } : {}),
  };
}

async function finishChunkedImport(
  sb: SupabaseClient,
  begin: BeginImportRpcRow,
  observations: MetricCsvObservation[],
  authoredBy: string | null,
  unavailableMessage: string,
): Promise<FinalImportRpcRow | ReturnType<typeof rpcFailure>> {
  let current: Pick<BeginImportRpcRow, "import_id" | "processed_rows" | "total_rows" | "next_chunk_index"> = begin;
  const expectedChunkIndex = Math.ceil(begin.processed_rows / METRIC_CSV_CHUNK_ROWS);
  const isValidBoundary = begin.processed_rows === begin.total_rows
    || begin.processed_rows % METRIC_CSV_CHUNK_ROWS === 0;
  if (!isValidBoundary
      || begin.next_chunk_index !== expectedChunkIndex
      || begin.total_rows !== observations.length) {
    return rpcFailure({ code: "55000", message: "Invalid import progress." }, unavailableMessage, progressOf(begin));
  }

  for (let chunkIndex = begin.next_chunk_index; chunkIndex * METRIC_CSV_CHUNK_ROWS < observations.length; chunkIndex += 1) {
    const chunk = observations.slice(
      chunkIndex * METRIC_CSV_CHUNK_ROWS,
      (chunkIndex + 1) * METRIC_CSV_CHUNK_ROWS,
    );
    const response = await retryImportRpc(sb, "append_metric_csv_import_chunk_v2", {
      p_import_id: begin.import_id,
      p_chunk_index: chunkIndex,
      p_chunk_digest: importDigest(chunk),
      p_observations: chunk,
      p_authored_by: authoredBy,
    });
    if (response.error) return rpcFailure(response.error, unavailableMessage, progressOf(current));
    const row = singleRow<ChunkImportRpcRow>(response);
    if (!row || !validProgress(row)) {
      return rpcFailure({ code: "55000", message: "Invalid import progress." }, unavailableMessage, progressOf(current));
    }
    current = row;
  }

  const finalized = await retryImportRpc(sb, "finalize_metric_csv_import_v2", {
    p_import_id: begin.import_id,
    p_authored_by: authoredBy,
  });
  if (finalized.error) return rpcFailure(finalized.error, unavailableMessage, progressOf(current));
  const row = singleRow<FinalImportRpcRow>(finalized);
  if (!validFinalRow(row)) {
    return rpcFailure({ code: "55000", message: "Invalid import receipt." }, unavailableMessage, progressOf(current));
  }
  return row;
}

/** Add or remove one workspace metric from the shared Core Metrics surface. */
export async function setWorkspaceCoreMetric(
  sb: SupabaseClient,
  input: {
    scopeId: string;
    metricId: string;
    isCore: boolean;
    authoredBy: string | null;
  },
): Promise<WorkspaceCoreMetricSelectionResult> {
  if (!validUuid(input.scopeId) || !validUuid(input.metricId)) {
    return { ok: false, code: "validation", error: "The workspace metric identity is invalid." };
  }
  if (input.authoredBy !== null && !validUuid(input.authoredBy)) {
    return { ok: false, code: "validation", error: "The selection author is invalid." };
  }

  const response = await sb.rpc("set_workspace_core_metric_v1", {
    p_scope_id: input.scopeId,
    p_metric_id: input.metricId,
    p_is_core: input.isCore,
    p_authored_by: input.authoredBy,
  });
  if (response.error) {
    if (response.error.code === "42501") {
      return { ok: false, code: "forbidden", error: "This workspace metric is unavailable." };
    }
    if (response.error.code === "22023") {
      return { ok: false, code: "validation", error: response.error.message };
    }
    console.error("[core-metric-selection] database selection failed:", response.error);
    return { ok: false, code: "database", error: "The core metric selection could not be saved. Try again." };
  }

  const rows = response.data as CoreMetricSelectionRpcRow[] | null;
  const row = rows?.length === 1 ? rows[0] : null;
  if (!row || !validUuid(row.selected_metric_id) || typeof row.is_core !== "boolean"
      || !Number.isInteger(row.core_metric_count) || row.core_metric_count < 0
      || row.core_metric_count > 5) {
    return { ok: false, code: "database", error: "The database returned an invalid core metric selection." };
  }
  return {
    ok: true,
    metricId: row.selected_metric_id,
    isCore: row.is_core,
    coreMetricCount: row.core_metric_count,
  };
}

/** Create/reuse a workspace CSV metric and resume its bounded import receipt. */
export async function importWorkspaceMetricCsv(
  sb: SupabaseClient,
  input: {
    scopeId: string;
    name: string;
    unit: "count" | "percent" | "USD";
    observations: MetricCsvObservation[];
    authoredBy: string | null;
  },
): Promise<WorkspaceMetricImportResult> {
  if (!validUuid(input.scopeId) || !validMetricName(input.name) || !validUnit(input.unit)) {
    return { ok: false, code: "validation", error: "Enter a valid metric name and unit." };
  }
  if (input.authoredBy !== null && !validUuid(input.authoredBy)) {
    return { ok: false, code: "validation", error: "The import author is invalid." };
  }
  const observations = normalizeObservations(input.observations);
  if (!observations) {
    return { ok: false, code: "validation", error: `Import one to ${METRIC_CSV_MAX_ROWS.toLocaleString("en-US")} unique daily observations.` };
  }

  const name = input.name.trim().replace(/\s+/g, " ");
  const response = await retryImportRpc(sb, "begin_workspace_metric_csv_import_v2", {
    p_scope_id: input.scopeId,
    p_name: name,
    p_unit: input.unit,
    p_content_hash: importDigest({
      schemaVersion: 2,
      target: { kind: "workspace_metric", scopeId: input.scopeId, name, unit: input.unit },
      observations,
    }),
    p_total_rows: observations.length,
    p_start_date: observations[0].date,
    p_end_date: observations.at(-1)!.date,
    p_authored_by: input.authoredBy,
  });
  if (response.error) {
    return rpcFailure(response.error, "This workspace is unavailable for metric import.");
  }
  const begin = singleRow<BeginImportRpcRow>(response);
  if (!validBeginRow(begin)) {
    return { ok: false, code: "database", error: "The database returned an invalid metric import summary." };
  }
  const resumed = begin.reused || begin.processed_rows > 0;
  const finalized = await finishChunkedImport(
    sb,
    begin,
    observations,
    input.authoredBy,
    "This workspace is unavailable for metric import.",
  );
  if ("ok" in finalized) return finalized;
  if (!validUnit(finalized.metric_unit)) {
    return { ok: false, code: "database", error: "The database returned an invalid metric import unit." };
  }
  return {
    ok: true,
    summary: {
      metricId: finalized.metric_id,
      metricName: finalized.metric_name,
      metricUnit: finalized.metric_unit,
      created: finalized.metric_created,
      acceptedRows: finalized.total_rows,
      insertedRows: finalized.inserted_rows,
      updatedRows: finalized.updated_rows,
      startDate: finalized.start_date,
      endDate: finalized.end_date,
      receipt: {
        importId: finalized.import_id,
        status: "complete",
        resumed: resumed || finalized.reused,
      },
    },
  };
}

export async function loadActiveReportMetricIdentity(
  sb: SupabaseClient,
  scopeId: string,
): Promise<{ reportId: string; metricId: string } | null> {
  if (!validUuid(scopeId)) return null;
  const workspaceResponse = await sb
    .from("workspaces")
    .select("current_decision_report_series_id")
    .eq("workspace_id", scopeId)
    .maybeSingle();
  if (workspaceResponse.error) throw workspaceResponse.error;
  const workspace = workspaceResponse.data as WorkspaceReportPointerRow | null;
  if (!workspace || !validUuid(workspace.current_decision_report_series_id)) return null;

  const seriesResponse = await sb
    .from("decision_report_series")
    .select("current_active_report_id")
    .eq("scope_id", scopeId)
    .eq("series_id", workspace.current_decision_report_series_id)
    .maybeSingle();
  if (seriesResponse.error) throw seriesResponse.error;
  const series = seriesResponse.data as ReportSeriesPointerRow | null;
  if (!series || !validUuid(series.current_active_report_id)) return null;

  const reportResponse = await sb
    .from("decision_reports")
    .select("report_id, series_id, active_metric_id, status, deleted_at")
    .eq("scope_id", scopeId)
    .eq("series_id", workspace.current_decision_report_series_id)
    .eq("report_id", series.current_active_report_id)
    .maybeSingle();
  if (reportResponse.error) throw reportResponse.error;
  const report = reportResponse.data as ActiveReportRow | null;
  if (
    !report ||
    report.status !== "active" ||
    report.deleted_at !== null ||
    report.series_id !== workspace.current_decision_report_series_id ||
    !validUuid(report.report_id) ||
    !validUuid(report.active_metric_id)
  ) return null;
  return { reportId: report.report_id, metricId: report.active_metric_id };
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
  const observations = normalizeObservations(input.observations);
  if (!observations) {
    return { ok: false, code: "validation", error: `Import one to ${METRIC_CSV_MAX_ROWS.toLocaleString("en-US")} unique daily observations.` };
  }
  const response = await retryImportRpc(sb, "begin_report_metric_csv_import_v2", {
    p_scope_id: input.scopeId,
    p_report_id: input.reportId,
    p_metric_id: input.metricId,
    p_content_hash: importDigest({
      schemaVersion: 2,
      target: {
        kind: "report_metric",
        scopeId: input.scopeId,
        reportId: input.reportId,
        metricId: input.metricId,
      },
      observations,
    }),
    p_total_rows: observations.length,
    p_start_date: observations[0].date,
    p_end_date: observations.at(-1)!.date,
    p_authored_by: input.authoredBy,
  });
  if (response.error) {
    return rpcFailure(response.error, "The active report metric is unavailable in this workspace.");
  }
  const begin = singleRow<BeginImportRpcRow>(response);
  if (!validBeginRow(begin)) {
    return { ok: false, code: "database", error: "The database returned an invalid import summary." };
  }
  const resumed = begin.reused || begin.processed_rows > 0;
  const finalized = await finishChunkedImport(
    sb,
    begin,
    observations,
    input.authoredBy,
    "The active report metric is unavailable in this workspace.",
  );
  if ("ok" in finalized) return finalized;
  return {
    ok: true,
    summary: {
      metricId: finalized.metric_id,
      metricName: finalized.metric_name,
      acceptedRows: finalized.total_rows,
      rejectedRows: 0,
      startDate: finalized.start_date,
      endDate: finalized.end_date,
      insertedRows: finalized.inserted_rows,
      updatedRows: finalized.updated_rows,
      existingObservationsUpdated: finalized.updated_rows > 0,
      receipt: {
        importId: finalized.import_id,
        status: "complete",
        resumed: resumed || finalized.reused,
      },
    },
  };
}
