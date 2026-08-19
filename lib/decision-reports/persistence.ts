import type { SupabaseClient } from "@supabase/supabase-js";

import { scanDecisionReportGaps } from "./editing.ts";
import {
  validateDecisionReport,
  validateMetricProjection,
  upgradeLegacyDecisionReportForEditing,
  type DecisionReportV1,
  type MetricProjection,
} from "./schema.ts";

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DecisionReportPersistenceStatus = "draft" | "report_ready" | "active";
type EditableDecisionReportStatus = Exclude<DecisionReportPersistenceStatus, "active">;

export type DecisionReportActivationPointer = {
  activationId: string;
  decisionId: string;
  predictionId: string;
  metricId: string;
  primaryLeverActionId: string | null;
  selectedMetricIds: string[];
  selectedActionSourceItemIds: string[];
  primaryLeverActionSourceItemId: string | null;
  actionBindings: Array<{
    actionId: string;
    actionSourceItemId: string;
    metricId: string;
  }>;
  activatedAt: string;
};

export type PersistedDecisionReport = {
  reportId: string;
  revisionId: string;
  baseRevisionId: string | null;
  status: DecisionReportPersistenceStatus;
  contentHash: string;
  savedAt: string;
  report: DecisionReportV1;
  metricProjection: MetricProjection;
  activation: DecisionReportActivationPointer | null;
  lineage: DecisionReportLineage | null;
};

export type DecisionReportLineage = {
  seriesId: string;
  iterationNumber: number;
  predecessorReportId: string | null;
  iterationReason: string | null;
};

export type StartDecisionReportIterationResult =
  | { ok: true; reportId: string; revisionId: string; seriesId: string; iterationNumber: number; reused: boolean; createdAt: string }
  | { ok: false; code: "validation" | "conflict" | "forbidden" | "database"; error: string; reportId?: string };

export type SaveDecisionReportInput = {
  reportId: string | null;
  baseRevisionId: string | null;
  /** Required for an untrusted initial v2 save; omitted only by trusted legacy fixtures. */
  sourceReceiptId?: string | null;
  report: DecisionReportV1;
  metricProjection: MetricProjection;
  authoredBy: string | null;
};

export type SaveDecisionReportResult =
  | {
      ok: true;
      saved: PersistedDecisionReport;
      reused: boolean;
    }
  | {
      ok: false;
      code: "validation" | "conflict" | "forbidden" | "database";
      error: string;
      currentRevisionId?: string;
    };

export type LoadDecisionReportResult =
  | { ok: true; saved: PersistedDecisionReport }
  | {
      ok: false;
      code: "validation" | "not_found" | "database";
      error: string;
    };

export type DeleteDecisionReportResult =
  | { ok: true; reportId: string; deletedAt: string; reused: boolean }
  | {
      ok: false;
      code: "validation" | "forbidden" | "database";
      error: string;
    };

type RpcSaveRow = {
  report_id: string;
  revision_id: string;
  base_revision_id: string | null;
  status: EditableDecisionReportStatus;
  content_hash: string;
  reused: boolean;
  saved_at: string;
};

type ReportRow = {
  report_id: string;
  status: DecisionReportPersistenceStatus;
  current_revision_id: string | null;
  active_activation_id: string | null;
  active_decision_id: string | null;
  active_prediction_id: string | null;
  active_metric_id: string | null;
  activated_at: string | null;
  series_id: string;
  iteration_number: number;
  predecessor_report_id: string | null;
  iteration_reason: string | null;
};

type RpcStartRow = {
  report_id: string;
  revision_id: string;
  series_id: string;
  iteration_number: number;
  reused: boolean;
  created_at: string;
};

type RevisionRow = {
  revision_id: string;
  base_revision_id: string | null;
  snapshot: unknown;
  metric_projection: unknown;
  content_hash: string;
  created_at: string;
};

type ActivationRow = {
  activation_id: string;
  report_id: string;
  revision_id: string;
  scope_id: string;
  metric_id: string;
  decision_id: string;
  prediction_id: string;
  action_ids: string[];
  selected_action_source_ids: string[];
  primary_lever_action_id: string | null;
  activated_at: string;
};

type ActivationActionMetricRow = {
  action_id: string;
  action_source_item_id: string;
  metric_id: string;
};

type ActivationMetricRow = {
  metric_id: string;
};

type RpcDeleteRow = {
  report_id: string;
  deleted_at: string;
  reused: boolean;
};

function persistenceStatus(report: DecisionReportV1): EditableDecisionReportStatus {
  return scanDecisionReportGaps(report).length === 0 ? "report_ready" : "draft";
}

function validUuid(value: string | null): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function validationFailure(errors: string[]): SaveDecisionReportResult {
  return {
    ok: false,
    code: "validation",
    error: errors.join("; "),
  };
}

function firstRpcRow(value: unknown): RpcSaveRow | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const row = value[0] as Partial<RpcSaveRow>;
  if (
    !validUuid(row.report_id ?? null) ||
    !validUuid(row.revision_id ?? null) ||
    !["draft", "report_ready"].includes(row.status ?? "") ||
    typeof row.content_hash !== "string" ||
    typeof row.reused !== "boolean" ||
    typeof row.saved_at !== "string"
  ) {
    return null;
  }
  return row as RpcSaveRow;
}

function firstDeleteRpcRow(value: unknown): RpcDeleteRow | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const row = value[0] as Partial<RpcDeleteRow>;
  if (
    !validUuid(row.report_id ?? null) ||
    typeof row.deleted_at !== "string" ||
    Number.isNaN(Date.parse(row.deleted_at)) ||
    typeof row.reused !== "boolean"
  ) {
    return null;
  }
  return row as RpcDeleteRow;
}

function databaseFailure(
  operation: string,
  error: unknown,
  userMessage: string,
): { ok: false; code: "database"; error: string } {
  // Persistence failures are only useful with their server-side diagnostics.
  // Never serialize Postgres constraint names or other implementation details
  // back through a Server Action to the browser.
  console.error(`[decision-report persistence] ${operation} failed`, error);
  return { ok: false, code: "database", error: userMessage };
}

export async function startDecisionReportIteration(
  sb: SupabaseClient,
  scopeId: string,
  parentReportId: string,
  reason: string,
  authoredBy: string | null,
): Promise<StartDecisionReportIterationResult> {
  const trimmedReason = reason.trim();
  if (!validUuid(scopeId) || !validUuid(parentReportId) || (authoredBy !== null && !validUuid(authoredBy)) || trimmedReason.length < 1 || trimmedReason.length > 500) {
    return { ok: false, code: "validation", error: "Enter an iteration reason between 1 and 500 characters." };
  }
  const response = await sb.rpc("start_decision_report_iteration_v1", {
    p_scope_id: scopeId,
    p_parent_report_id: parentReportId,
    p_reason: trimmedReason,
    p_authored_by: authoredBy,
  });
  if (response.error) {
    if (response.error.code === "PT409") {
      return {
        ok: false,
        code: "conflict",
        error: "A successor already exists with different iteration details.",
        reportId: validUuid(response.error.details) ? response.error.details : undefined,
      };
    }
    if (response.error.code === "42501") {
      return {
        ok: false,
        code: "forbidden",
        error: "This report is unavailable or is no longer current.",
      };
    }
    if (response.error.code === "22023") {
      return {
        ok: false,
        code: "validation",
        error: "The iteration request was rejected. Check the reason and try again.",
      };
    }
    return databaseFailure(
      "start iteration",
      response.error,
      "Causent could not start the next iteration. Try again.",
    );
  }
  if (!Array.isArray(response.data) || response.data.length !== 1) {
    return databaseFailure(
      "validate iteration receipt",
      { rowCount: Array.isArray(response.data) ? response.data.length : null },
      "Causent could not confirm the new iteration. Reload Reports before trying again.",
    );
  }
  const row = response.data[0] as Partial<RpcStartRow>;
  if (
    !validUuid(row.report_id ?? null) ||
    !validUuid(row.revision_id ?? null) ||
    !validUuid(row.series_id ?? null) ||
    !Number.isInteger(row.iteration_number) ||
    (row.iteration_number ?? 0) < 2 ||
    typeof row.reused !== "boolean" ||
    typeof row.created_at !== "string"
  ) {
    return databaseFailure(
      "validate iteration receipt",
      { hasReceipt: true },
      "Causent could not confirm the new iteration. Reload Reports before trying again.",
    );
  }
  const validRow = row as RpcStartRow;
  return { ok: true, reportId: validRow.report_id, revisionId: validRow.revision_id, seriesId: validRow.series_id, iterationNumber: validRow.iteration_number, reused: validRow.reused, createdAt: validRow.created_at };
}

export async function deleteDecisionReport(
  sb: SupabaseClient,
  scopeId: string,
  reportId: string,
  authoredBy: string | null,
): Promise<DeleteDecisionReportResult> {
  if (
    !validUuid(scopeId) ||
    !validUuid(reportId) ||
    (authoredBy !== null && !validUuid(authoredBy))
  ) {
    return { ok: false, code: "validation", error: "Report address is invalid." };
  }
  const response = await sb.rpc("delete_decision_report_v1", {
    p_scope_id: scopeId,
    p_report_id: reportId,
    p_authored_by: authoredBy,
  });
  if (response.error) {
    if (response.error.code === "42501") {
      return {
        ok: false,
        code: "forbidden",
        error: "This report is unavailable in the current workspace.",
      };
    }
    return databaseFailure(
      "delete report",
      response.error,
      "Causent could not remove this report. Reload Reports and try again.",
    );
  }
  const row = firstDeleteRpcRow(response.data);
  if (!row) {
    return databaseFailure(
      "validate deletion receipt",
      { hasReceipt: Array.isArray(response.data) && response.data.length > 0 },
      "Causent could not confirm that the report was removed. Reload Reports before trying again.",
    );
  }
  return {
    ok: true,
    reportId: row.report_id,
    deletedAt: row.deleted_at,
    reused: row.reused,
  };
}

export async function saveDecisionReport(
  sb: SupabaseClient,
  scopeId: string,
  input: SaveDecisionReportInput,
): Promise<SaveDecisionReportResult> {
  if (!validUuid(scopeId)) return validationFailure(["Workspace ID is invalid."]);
  if (input.reportId !== null && !validUuid(input.reportId)) {
    return validationFailure(["Report ID is invalid."]);
  }
  if (input.reportId === null && input.baseRevisionId !== null) {
    return validationFailure(["A new report cannot have a base revision."]);
  }
  if (input.reportId !== null && !validUuid(input.baseRevisionId)) {
    return validationFailure(["Saved reports require a valid base revision."]);
  }
  if (input.reportId === null && input.sourceReceiptId === null) {
    return validationFailure(["Generated report source receipt is required."]);
  }
  if (
    input.sourceReceiptId !== undefined &&
    input.sourceReceiptId !== null &&
    !validUuid(input.sourceReceiptId)
  ) {
    return validationFailure(["Generated report source receipt is invalid."]);
  }
  if (input.reportId !== null && input.sourceReceiptId) {
    return validationFailure(["A source receipt can only authorize the first report save."]);
  }
  if (input.authoredBy !== null && !validUuid(input.authoredBy)) {
    return validationFailure(["Author ID is invalid."]);
  }

  const reportValidation = validateDecisionReport(input.report);
  const projectionValidation = validateMetricProjection(input.metricProjection);
  if (!reportValidation.success || !projectionValidation.success) {
    return validationFailure([
      ...(reportValidation.success ? [] : reportValidation.errors),
      ...(projectionValidation.success ? [] : projectionValidation.errors),
    ]);
  }
  if (reportValidation.data.schemaVersion !== 2) {
    return validationFailure([
      "Legacy report provenance must be upgraded before this revision can be saved.",
    ]);
  }

  const status = persistenceStatus(reportValidation.data);
  const common = {
    p_title: reportValidation.data.title,
    p_status: status,
    p_snapshot: reportValidation.data,
    p_metric_projection: projectionValidation.data,
    p_authored_by: input.authoredBy,
  };

  const response = input.reportId === null
    ? input.sourceReceiptId
      ? await sb.rpc("create_decision_report_v2", {
          p_scope_id: scopeId,
          p_source_receipt_id: input.sourceReceiptId,
          ...common,
        })
      : await sb.rpc("create_decision_report_v1", {
          p_scope_id: scopeId,
          ...common,
        })
    : await sb.rpc("append_decision_report_revision_v1", {
        p_report_id: input.reportId,
        p_base_revision_id: input.baseRevisionId,
        ...common,
      });

  if (response.error) {
    if (response.error.code === "PT409" && response.error.message.includes("STALE_REVISION")) {
      const currentRevisionId = validUuid(response.error.details ?? null)
        ? response.error.details
        : undefined;
      return {
        ok: false,
        code: "conflict",
        error: "This report changed in another tab. Reload the saved version before trying again.",
        currentRevisionId,
      };
    }
    if (response.error.code === "PT409" && response.error.message.includes("REPORT_ALREADY_ACTIVE")) {
      return {
        ok: false,
        code: "conflict",
        error: "This report is already active and can no longer be edited.",
      };
    }
    if (response.error.code === "PT409" && response.error.message.includes("SOURCE_RECEIPT_ALREADY_USED")) {
      return {
        ok: false,
        code: "conflict",
        error: "This generated draft changed after its source receipt was used. Start a new draft.",
      };
    }
    if (response.error.code === "42501") {
      if (input.reportId === null && input.sourceReceiptId) {
        return {
          ok: false,
          code: "forbidden",
          error: "This generated draft can no longer be saved securely. Generate the draft again, then reapply any edits.",
        };
      }
      return {
        ok: false,
        code: "forbidden",
        error: "This report is unavailable in the current workspace.",
      };
    }
    return databaseFailure(
      "save report",
      response.error,
      "Causent could not save this report. Reload the saved version and try again.",
    );
  }

  const row = firstRpcRow(response.data);
  if (!row) {
    return databaseFailure(
      "validate saved revision receipt",
      { hasReceipt: Array.isArray(response.data) && response.data.length > 0 },
      "Causent could not confirm the saved revision. Reload the report before trying again.",
    );
  }

  return {
    ok: true,
    reused: row.reused,
    saved: {
      reportId: row.report_id,
      revisionId: row.revision_id,
      baseRevisionId: row.base_revision_id,
      status: row.status,
      contentHash: row.content_hash,
      savedAt: row.saved_at,
      report: reportValidation.data,
      metricProjection: projectionValidation.data,
      activation: null,
      lineage: null,
    },
  };
}

export async function loadDecisionReport(
  sb: SupabaseClient,
  scopeId: string,
  reportId: string,
): Promise<LoadDecisionReportResult> {
  if (!validUuid(scopeId) || !validUuid(reportId)) {
    return { ok: false, code: "validation", error: "Report address is invalid." };
  }

  const reportResponse = await sb
    .from("decision_reports")
    .select(
      "report_id, status, current_revision_id, active_activation_id, active_decision_id, " +
        "active_prediction_id, active_metric_id, activated_at, series_id, iteration_number, " +
        "predecessor_report_id, iteration_reason",
    )
    .eq("scope_id", scopeId)
    .eq("report_id", reportId)
    .is("deleted_at", null)
    .maybeSingle();
  if (reportResponse.error) {
    return databaseFailure(
      "load report",
      reportResponse.error,
      "Causent could not load this saved report. Try again from Reports.",
    );
  }
  if (!reportResponse.data) {
    return { ok: false, code: "not_found", error: "Saved report not found." };
  }

  const reportRow = reportResponse.data as unknown as ReportRow;
  if (!["draft", "report_ready", "active"].includes(reportRow.status)) {
    return { ok: false, code: "database", error: "Saved report has an invalid status." };
  }
  if (!validUuid(reportRow.current_revision_id)) {
    return { ok: false, code: "database", error: "Saved report has no current revision." };
  }
  if (!validUuid(reportRow.series_id) || !Number.isInteger(reportRow.iteration_number) || reportRow.iteration_number < 1) {
    return { ok: false, code: "database", error: "Saved report lineage is invalid." };
  }

  const revisionResponse = await sb
    .from("decision_report_revisions")
    .select(
      "revision_id, base_revision_id, snapshot, metric_projection, content_hash, created_at",
    )
    .eq("scope_id", scopeId)
    .eq("report_id", reportId)
    .eq("revision_id", reportRow.current_revision_id)
    .maybeSingle();
  if (revisionResponse.error) {
    return databaseFailure(
      "load report revision",
      revisionResponse.error,
      "Causent could not load this saved report. Try again from Reports.",
    );
  }
  if (!revisionResponse.data) {
    return { ok: false, code: "not_found", error: "Saved report revision not found." };
  }

  const revisionRow = revisionResponse.data as RevisionRow;
  const reportValidation = validateDecisionReport(revisionRow.snapshot);
  const projectionValidation = validateMetricProjection(revisionRow.metric_projection);
  if (!reportValidation.success || !projectionValidation.success) {
    return {
      ok: false,
      code: "database",
      error: "Saved report revision failed runtime validation.",
    };
  }

  let activation: DecisionReportActivationPointer | null = null;
  if (reportRow.status === "active") {
    if (
      !validUuid(reportRow.active_activation_id) ||
      !validUuid(reportRow.active_decision_id) ||
      !validUuid(reportRow.active_prediction_id) ||
      !validUuid(reportRow.active_metric_id) ||
      typeof reportRow.activated_at !== "string" ||
      Number.isNaN(Date.parse(reportRow.activated_at))
    ) {
      return { ok: false, code: "database", error: "Active report pointers are invalid." };
    }

    const activationResponse = await sb
      .from("decision_report_activations")
      .select(
        "activation_id, report_id, revision_id, scope_id, metric_id, decision_id, " +
          "prediction_id, action_ids, selected_action_source_ids, " +
          "primary_lever_action_id, activated_at",
      )
      .eq("scope_id", scopeId)
      .eq("report_id", reportId)
      .eq("revision_id", revisionRow.revision_id)
      .eq("activation_id", reportRow.active_activation_id)
      .maybeSingle();
    if (activationResponse.error) {
      return databaseFailure(
        "load report activation",
        activationResponse.error,
        "Causent could not load this saved report. Try again from Reports.",
      );
    }
    const activationRow = activationResponse.data as ActivationRow | null;
    if (
      !activationRow ||
      activationRow.report_id !== reportId ||
      activationRow.revision_id !== revisionRow.revision_id ||
      activationRow.scope_id !== scopeId ||
      activationRow.metric_id !== reportRow.active_metric_id ||
      activationRow.decision_id !== reportRow.active_decision_id ||
      activationRow.prediction_id !== reportRow.active_prediction_id ||
      !Array.isArray(activationRow.action_ids) ||
      activationRow.action_ids.length < 1 ||
      activationRow.action_ids.length > 25 ||
      activationRow.action_ids.some((actionId) => !validUuid(actionId)) ||
      new Set(activationRow.action_ids).size !== activationRow.action_ids.length ||
      !Array.isArray(activationRow.selected_action_source_ids) ||
      activationRow.selected_action_source_ids.length !== activationRow.action_ids.length ||
      activationRow.selected_action_source_ids.some(
        (sourceItemId) => typeof sourceItemId !== "string" || sourceItemId.trim() === "",
      ) ||
      new Set(activationRow.selected_action_source_ids).size !==
        activationRow.selected_action_source_ids.length ||
      (activationRow.primary_lever_action_id !== null &&
        !validUuid(activationRow.primary_lever_action_id)) ||
      Date.parse(activationRow.activated_at) !== Date.parse(reportRow.activated_at)
    ) {
      return {
        ok: false,
        code: "database",
        error: "Active report pointers do not match the activation audit.",
      };
    }

    const [metricResponse, bindingResponse] = await Promise.all([
      sb
        .from("decision_report_activation_metrics")
        .select("metric_id")
        .eq("scope_id", scopeId)
        .eq("activation_id", activationRow.activation_id),
      sb
        .from("decision_report_activation_action_metrics")
        .select("action_id, action_source_item_id, metric_id")
        .eq("scope_id", scopeId)
        .eq("activation_id", activationRow.activation_id),
    ]);
    if (metricResponse.error) {
      return databaseFailure(
        "load report metrics",
        metricResponse.error,
        "Causent could not load this saved report. Try again from Reports.",
      );
    }
    if (bindingResponse.error) {
      return databaseFailure(
        "load report action bindings",
        bindingResponse.error,
        "Causent could not load this saved report. Try again from Reports.",
      );
    }
    const metricRows = (metricResponse.data ?? []) as unknown as ActivationMetricRow[];
    const selectedMetricIds = metricRows.map((row) => row.metric_id);
    const selectedMetricIdSet = new Set(selectedMetricIds);
    if (
      selectedMetricIds.length < 1 ||
      selectedMetricIds.length > 5 ||
      selectedMetricIds.some((metricId) => !validUuid(metricId)) ||
      selectedMetricIdSet.size !== selectedMetricIds.length ||
      !selectedMetricIdSet.has(reportRow.active_metric_id)
    ) {
      return {
        ok: false,
        code: "database",
        error: "Active report metrics do not match the activation audit.",
      };
    }
    const bindingRows = (bindingResponse.data ?? []) as unknown as ActivationActionMetricRow[];
    const reportActionSourceIds = new Set(
      reportValidation.data.implementation.actions.map((action) => action.sourceItemId),
    );
    const bindingActionIds = new Set<string>();
    const bindingSourceIds = new Set<string>();
    const bindingBySourceId = new Map<string, ActivationActionMetricRow>();
    let bindingInvalid = bindingRows.length !== activationRow.action_ids.length;
    for (const binding of bindingRows) {
      if (
        !validUuid(binding.action_id) ||
        typeof binding.action_source_item_id !== "string" ||
        binding.action_source_item_id.trim() === "" ||
        !validUuid(binding.metric_id) ||
        bindingActionIds.has(binding.action_id) ||
        bindingSourceIds.has(binding.action_source_item_id) ||
        !activationRow.action_ids.includes(binding.action_id) ||
        !activationRow.selected_action_source_ids.includes(binding.action_source_item_id) ||
        !selectedMetricIdSet.has(binding.metric_id) ||
        !reportActionSourceIds.has(binding.action_source_item_id)
      ) {
        bindingInvalid = true;
        break;
      }
      bindingActionIds.add(binding.action_id);
      bindingSourceIds.add(binding.action_source_item_id);
      bindingBySourceId.set(binding.action_source_item_id, binding);
    }
    const primaryBinding = activationRow.primary_lever_action_id === null
      ? null
      : bindingRows.find(
          (binding) => binding.action_id === activationRow.primary_lever_action_id,
        ) ?? null;
    if (
      bindingInvalid ||
      activationRow.action_ids.some((actionId) => !bindingActionIds.has(actionId)) ||
      activationRow.selected_action_source_ids.some(
        (sourceItemId) => !bindingSourceIds.has(sourceItemId),
      ) ||
      (
        activationRow.primary_lever_action_id !== null &&
        (!primaryBinding || primaryBinding.metric_id !== reportRow.active_metric_id)
      )
    ) {
      return {
        ok: false,
        code: "database",
        error: "Active report action bindings do not match the activation audit.",
      };
    }
    const orderedBindings = reportValidation.data.implementation.actions.flatMap((action) => {
      const binding = bindingBySourceId.get(action.sourceItemId);
      return binding ? [binding] : [];
    });
    if (orderedBindings.length !== bindingRows.length) {
      return {
        ok: false,
        code: "database",
        error: "Active report action bindings do not match the saved revision.",
      };
    }
    activation = {
      activationId: reportRow.active_activation_id,
      decisionId: reportRow.active_decision_id,
      predictionId: reportRow.active_prediction_id,
      metricId: reportRow.active_metric_id,
      primaryLeverActionId: activationRow.primary_lever_action_id,
      selectedMetricIds,
      selectedActionSourceItemIds: orderedBindings.map(
        (binding) => binding.action_source_item_id,
      ),
      primaryLeverActionSourceItemId: primaryBinding?.action_source_item_id ?? null,
      actionBindings: orderedBindings.map((binding) => ({
        actionId: binding.action_id,
        actionSourceItemId: binding.action_source_item_id,
        metricId: binding.metric_id,
      })),
      activatedAt: reportRow.activated_at,
    };
  }

  return {
    ok: true,
    saved: {
      reportId: reportRow.report_id,
      revisionId: revisionRow.revision_id,
      baseRevisionId: revisionRow.base_revision_id,
      status: reportRow.status,
      contentHash: revisionRow.content_hash,
      savedAt: revisionRow.created_at,
      report:
        reportRow.status === "active"
          ? reportValidation.data
          : upgradeLegacyDecisionReportForEditing(reportValidation.data),
      metricProjection: projectionValidation.data,
      activation,
      lineage: {
        seriesId: reportRow.series_id,
        iterationNumber: reportRow.iteration_number,
        predecessorReportId: reportRow.predecessor_report_id,
        iterationReason: reportRow.iteration_reason,
      },
    },
  };
}
