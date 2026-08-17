import type { SupabaseClient } from "@supabase/supabase-js";

import {
  validateReportActivationInput,
  type ReportActivationInput,
} from "./activation.ts";
import { formatFromUnit } from "../data/config.ts";
import type { MetricFormat } from "../types.ts";
import { UUID_PATTERN } from "./persistence.ts";

export type ReportMetricReadiness =
  | "Ready to monitor"
  | "Needs data"
  | "Causal window not ready";

export type ReportActivationMetric = {
  metricId: string;
  name: string;
  source: string;
  unit: string | null;
  format: MetricFormat;
  percentScale: "ratio" | "points";
  hasObservations: boolean;
  lastObservationDate: string | null;
  lastObservationValue: number | null;
  preHistoryObservationCount: number;
  preHistoryDays: number;
  readiness: ReportMetricReadiness;
  earliestConfidentReviewDate: string;
  isCore: boolean;
};

export type MaterializedReportActivation = {
  activationId: string;
  decisionId: string;
  predictionId: string;
  actionIds: string[];
  primaryLeverActionId: string;
  reused: boolean;
  activatedAt: string;
};

export type MaterializeReportActivationResult =
  | { ok: true; activation: MaterializedReportActivation }
  | {
      ok: false;
      code: "validation" | "conflict" | "forbidden" | "database";
      error: string;
      activationId?: string;
    };

export type AuthorizeReportActivationTargetResult =
  | { ok: true }
  | Extract<MaterializeReportActivationResult, { ok: false }>;

export type ReportActionStartTargetValidation =
  | { success: true; actionSourceItemId: string }
  | { success: false; error: string };

export type ResolveActivatedReportActionResult =
  | { ok: true; actionId: string }
  | {
      ok: false;
      code: "validation" | "forbidden" | "database";
      error: string;
    };

type ActivationRpcRow = {
  activation_id: string;
  decision_id: string;
  prediction_id: string;
  action_ids: string[];
  primary_lever_action_id: string;
  reused: boolean;
  activated_at: string;
};

type MetricRow = {
  metric_id: string;
  name: string;
  source: string;
  unit: string | null;
  is_core: boolean;
  has_observations: boolean;
  last_observation_date: string | null;
  last_observation_value: number | string | null;
  pre_history_observation_count: number;
  pre_history_days: number;
  readiness: ReportMetricReadiness;
  earliest_confident_review_date: string;
  percent_scale: "ratio" | "points";
};

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function validActionSourceItemId(value: unknown): value is string {
  return typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= 500 &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

/**
 * Validate the action-level execution intent separately from the immutable
 * activation packet. The source item selects only the post-activation target;
 * it must never change the activation hash or the pre-registered primary
 * action.
 */
export function validateReportActionStartTarget(
  value: unknown,
  selectedActionSourceItemIds: readonly string[],
): ReportActionStartTargetValidation {
  if (
    !validActionSourceItemId(value) ||
    !selectedActionSourceItemIds.includes(value)
  ) {
    return {
      success: false,
      error: "Choose an action from this report.",
    };
  }
  return { success: true, actionSourceItemId: value };
}

/**
 * Bind a caller-supplied report packet to the workspace selected by the
 * authenticated session before invoking the checked activation RPC. This
 * explicit guard is required for privileged local-demo clients that bypass
 * RLS, and it keeps missing, stale, deleted, and cross-workspace targets
 * indistinguishable to the caller. The RPC remains the atomic authority for
 * revision and activation races after this preflight.
 */
export async function authorizeReportActivationTarget(
  sb: SupabaseClient,
  input: {
    scopeId: string;
    reportId: string;
    revisionId: string;
  },
): Promise<AuthorizeReportActivationTargetResult> {
  if (
    !validUuid(input.scopeId) ||
    !validUuid(input.reportId) ||
    !validUuid(input.revisionId)
  ) {
    return {
      ok: false,
      code: "validation",
      error: "The report activation target is invalid.",
    };
  }

  const response = await sb
    .from("decision_reports")
    .select("report_id")
    .eq("scope_id", input.scopeId)
    .eq("report_id", input.reportId)
    .eq("current_revision_id", input.revisionId)
    .is("deleted_at", null)
    .maybeSingle();

  if (response.error) {
    if (response.error.code !== "42501") {
      console.error(
        "[decision-report activation] workspace authorization failed",
        response.error,
      );
      return {
        ok: false,
        code: "database",
        error: "Causent could not verify this report in the current workspace.",
      };
    }
    return {
      ok: false,
      code: "forbidden",
      error: "This report is unavailable in the current workspace.",
    };
  }

  const row = response.data as { report_id?: unknown } | null;
  if (!row || row.report_id !== input.reportId) {
    return {
      ok: false,
      code: "forbidden",
      error: "This report is unavailable in the current workspace.",
    };
  }

  return { ok: true };
}

/**
 * Resolve one reviewed source item to its canonical action after activation.
 * The current workspace is always part of the lookup so the local-demo
 * service-role escape hatch retains the same isolation shape as production.
 * A hidden/missing/malformed binding never yields a caller-supplied identity.
 */
export async function resolveActivatedReportAction(
  sb: SupabaseClient,
  input: {
    scopeId: string;
    activationId: string;
    actionSourceItemId: string;
    expectedActionIds: readonly string[];
  },
): Promise<ResolveActivatedReportActionResult> {
  if (
    !validUuid(input.scopeId) ||
    !validUuid(input.activationId) ||
    !validActionSourceItemId(input.actionSourceItemId) ||
    input.expectedActionIds.length < 1 ||
    input.expectedActionIds.length > 25 ||
    input.expectedActionIds.some((actionId) => !validUuid(actionId)) ||
    new Set(input.expectedActionIds).size !== input.expectedActionIds.length
  ) {
    return {
      ok: false,
      code: "validation",
      error: "The activated action target is invalid.",
    };
  }

  const response = await sb
    .from("decision_report_activation_action_metrics")
    .select("action_id")
    .eq("scope_id", input.scopeId)
    .eq("activation_id", input.activationId)
    .eq("action_source_item_id", input.actionSourceItemId)
    .maybeSingle();

  if (response.error) {
    if (response.error.code === "42501") {
      return {
        ok: false,
        code: "forbidden",
        error: "This action is unavailable in the current workspace.",
      };
    }
    return {
      ok: false,
      code: "database",
      error: "Causent could not open that action after activation.",
    };
  }

  const row = response.data as { action_id?: unknown } | null;
  if (!row) {
    return {
      ok: false,
      code: "forbidden",
      error: "This action is unavailable in the current workspace.",
    };
  }
  if (
    !validUuid(row.action_id) ||
    !input.expectedActionIds.includes(row.action_id)
  ) {
    return {
      ok: false,
      code: "database",
      error: "Causent could not open that action after activation.",
    };
  }

  return { ok: true, actionId: row.action_id };
}

function firstActivationRow(value: unknown): ActivationRpcRow | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const row = value[0] as Partial<ActivationRpcRow>;
  if (
    !validUuid(row.activation_id) ||
    !validUuid(row.decision_id) ||
    !validUuid(row.prediction_id) ||
    !Array.isArray(row.action_ids) ||
    row.action_ids.length < 1 ||
    row.action_ids.length > 25 ||
    row.action_ids.some((id) => !validUuid(id)) ||
    new Set(row.action_ids).size !== row.action_ids.length ||
    !validUuid(row.primary_lever_action_id) ||
    !row.action_ids.includes(row.primary_lever_action_id) ||
    typeof row.reused !== "boolean" ||
    typeof row.activated_at !== "string" ||
    Number.isNaN(Date.parse(row.activated_at))
  ) {
    return null;
  }
  return row as ActivationRpcRow;
}

export async function loadReportActivationMetrics(
  sb: SupabaseClient,
  scopeId: string,
): Promise<ReportActivationMetric[]> {
  if (!validUuid(scopeId)) return [];
  const response = await sb.rpc("list_decision_report_activation_metrics_v2", {
    p_scope_id: scopeId,
  });
  if (response.error) throw response.error;

  const rows = ((response.data ?? []) as MetricRow[]).filter(
    (row) => validUuid(row.metric_id) && typeof row.name === "string" && row.name.trim(),
  );
  return rows.flatMap((row) => {
    if (!validUuid(row.metric_id) || typeof row.name !== "string" || !row.name.trim()) {
      return [];
    }
    return [{
      metricId: row.metric_id,
      name: row.name,
      source: row.source,
      unit: row.unit,
      format: formatFromUnit(row.unit),
      percentScale: row.percent_scale === "ratio" ? "ratio" : "points",
      hasObservations: row.has_observations === true,
      lastObservationDate: row.last_observation_date,
      lastObservationValue:
        row.last_observation_value === null ||
          !Number.isFinite(Number(row.last_observation_value))
          ? null
          : Number(row.last_observation_value),
      preHistoryObservationCount: Math.max(
        0,
        Math.floor(Number(row.pre_history_observation_count) || 0),
      ),
      preHistoryDays: Math.max(0, Math.floor(Number(row.pre_history_days) || 0)),
      readiness: [
        "Ready to monitor",
        "Needs data",
        "Causal window not ready",
      ].includes(row.readiness)
        ? row.readiness
        : "Needs data",
      earliestConfidentReviewDate: row.earliest_confident_review_date,
      isCore: row.is_core === true,
    }];
  });
}

export async function materializeReportActivation(
  sb: SupabaseClient,
  input: ReportActivationInput,
  activatedBy: string | null,
): Promise<MaterializeReportActivationResult> {
  const validation = validateReportActivationInput(input, {
    allowExpiredResolutionDate: input.schemaVersion === 2,
  });
  if (!validation.success) {
    return { ok: false, code: "validation", error: validation.errors.join("; ") };
  }
  if (activatedBy !== null && !validUuid(activatedBy)) {
    return { ok: false, code: "validation", error: "Activation author is invalid." };
  }

  const commonArgs = {
    p_report_id: validation.data.reportId,
    p_revision_id: validation.data.revisionId,
    p_prediction_direction: validation.data.prediction.direction,
    p_prediction_magnitude_pct_mean: validation.data.prediction.magnitudePctMean,
    p_prediction_resolution_date: validation.data.prediction.resolutionDate,
    p_selected_action_source_ids: validation.data.selectedActionSourceItemIds,
    p_primary_lever_source_id: validation.data.primaryLeverActionSourceItemId,
    p_activated_by: activatedBy,
  };
  const response = validation.data.schemaVersion === 1
    ? await sb.rpc("activate_decision_report_v2", {
      ...commonArgs,
      p_metric_id: validation.data.confirmedMetricId,
    })
    : await sb.rpc("activate_decision_report_v3", {
      ...commonArgs,
      p_primary_metric_id: validation.data.confirmedMetricId,
      p_selected_metric_ids: validation.data.selectedMetricIds,
      p_action_metric_assignments: validation.data.actionMetricAssignments,
    });

  if (response.error) {
    if (response.error.code === "PT409" && response.error.message.includes("STALE_ITERATION_PARENT")) {
      return { ok: false, code: "conflict", error: "This iteration is stale because the series current report changed." };
    }
    if (response.error.code === "PT409" && response.error.message.includes("REPORT_ALREADY_ACTIVE")) {
      return {
        ok: false,
        code: "conflict",
        error: "This report is already active with different activation choices.",
        activationId: validUuid(response.error.details) ? response.error.details : undefined,
      };
    }
    if (response.error.code === "42501") {
      return {
        ok: false,
        code: "forbidden",
        error: "This report or metric is unavailable in the current workspace.",
      };
    }
    if (response.error.code === "22023") {
      return { ok: false, code: "validation", error: response.error.message };
    }
    return { ok: false, code: "database", error: response.error.message };
  }

  const row = firstActivationRow(response.data);
  if (!row) {
    return {
      ok: false,
      code: "database",
      error: "The database returned an invalid report activation.",
    };
  }

  return {
    ok: true,
    activation: {
      activationId: row.activation_id,
      decisionId: row.decision_id,
      predictionId: row.prediction_id,
      actionIds: row.action_ids,
      primaryLeverActionId: row.primary_lever_action_id,
      reused: row.reused,
      activatedAt: row.activated_at,
    },
  };
}
