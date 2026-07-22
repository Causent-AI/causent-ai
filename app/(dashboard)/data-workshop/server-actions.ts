"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { getServerSupabase, isLocalDemo } from "@/lib/supabase-server";
import { METRIC_CSV_MAX_BYTES, parseMetricCsv } from "@/lib/metrics/csv";
import {
  importReportMetricObservations,
  loadActiveReportMetricIdentity,
  type MetricImportSummary,
} from "@/lib/metrics/import";

export type MetricCsvImportActionState =
  | { status: "idle" }
  | {
      status: "error";
      error: string;
      acceptedRows: number;
      rejectedRows: number;
      details: string[];
    }
  | { status: "success"; summary: MetricImportSummary };

const errorState = (
  error: string,
  acceptedRows = 0,
  rejectedRows = 0,
  details: string[] = [],
): MetricCsvImportActionState => ({ status: "error", error, acceptedRows, rejectedRows, details });

export async function importActiveReportMetricCsvAction(
  _previous: MetricCsvImportActionState,
  formData: FormData,
): Promise<MetricCsvImportActionState> {
  const session = await getSession();
  if (!isLocalDemo() && !session.userId) {
    return errorState("Sign in before importing metric observations.");
  }
  const entry = formData.get("csv");
  if (!(entry instanceof File) || !entry.name) return errorState("Choose one CSV file to import.");
  if (!entry.name.toLowerCase().endsWith(".csv")) return errorState("Choose a file whose name ends in .csv.");
  if (entry.size > METRIC_CSV_MAX_BYTES) {
    return errorState(`CSV files must be ${METRIC_CSV_MAX_BYTES / 1024} KB or smaller.`);
  }

  const parsed = parseMetricCsv(new Uint8Array(await entry.arrayBuffer()));
  if (!parsed.ok) {
    return errorState(parsed.error, parsed.acceptedRows, parsed.rejectedRows, parsed.details);
  }

  const sb = await getServerSupabase();
  const target = await loadActiveReportMetricIdentity(sb, session.workspaceId);
  if (!target) return errorState("Activate a Decision Report before importing its confirmed metric.");
  const result = await importReportMetricObservations(sb, {
    scopeId: session.workspaceId,
    reportId: target.reportId,
    metricId: target.metricId,
    observations: parsed.observations,
    authoredBy: session.userId,
  });
  if (!result.ok) return errorState(result.error);

  revalidatePath("/data-workshop");
  // Core Metrics is mounted in the shared dashboard layout on every tab.
  revalidatePath("/", "layout");
  return { status: "success", summary: result.summary };
}
