import { cache } from "react";

import { UUID_PATTERN } from "../decision-reports/persistence.ts";
import { getServerSupabase } from "../supabase-server.ts";

export type DecisionReportActionMetricBinding = {
  actionId: string;
  actionSourceItemId: string;
  metricId: string;
  monitoringExpectedDirection: "INCREASE" | "DECREASE" | null;
  monitoringCheckDate: string | null;
};

export type CurrentDecisionReportActivationContract = {
  activationId: string;
  reportId: string;
  decisionId: string;
  predictionId: string;
  contractVersion: 1 | 2;
  primaryMetricId: string;
  selectedMetricIds: string[];
  actionIds: string[];
  registeredPrimaryActionId: string;
  actionBindings: DecisionReportActionMetricBinding[];
  causalObject: "registered_primary_action" | "decision_package";
  interventionActionId: string | null;
  interventionDate: string | null;
  packageCompletedAt: string | null;
  packageHash: string | null;
};

type ActivationRow = {
  activation_id: string;
  report_id: string;
  decision_id: string;
  prediction_id: string;
  contract_version: number;
  metric_id: string;
  action_ids: string[];
  selected_action_source_ids: string[];
  primary_lever_action_id: string | null;
};

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function validOptionalDate(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Load the explicitly current report's normalized activation graph. No metric
 * meaning is reconstructed from action rationale compatibility metadata.
 */
export const loadCurrentDecisionReportActivationContract = cache(
  async function loadCurrentDecisionReportActivationContract(
    scopeId: string,
  ): Promise<CurrentDecisionReportActivationContract | null> {
    if (!validUuid(scopeId)) return null;
    const sb = await getServerSupabase();
    const workspace = await sb.from("workspaces")
      .select("current_decision_report_series_id")
      .eq("workspace_id", scopeId)
      .maybeSingle();
    if (workspace.error) throw workspace.error;
    const seriesId = (workspace.data as {
      current_decision_report_series_id?: unknown;
    } | null)?.current_decision_report_series_id;
    if (!validUuid(seriesId)) return null;

    const series = await sb.from("decision_report_series")
      .select("current_active_report_id")
      .eq("scope_id", scopeId)
      .eq("series_id", seriesId)
      .maybeSingle();
    if (series.error) throw series.error;
    const reportId = (series.data as {
      current_active_report_id?: unknown;
    } | null)?.current_active_report_id;
    if (!validUuid(reportId)) return null;

    const report = await sb.from("decision_reports")
      .select("active_activation_id, active_decision_id, active_prediction_id, active_metric_id")
      .eq("scope_id", scopeId)
      .eq("report_id", reportId)
      .eq("status", "active")
      .is("deleted_at", null)
      .maybeSingle();
    if (report.error) throw report.error;
    const reportRow = report.data as {
      active_activation_id?: unknown;
      active_decision_id?: unknown;
      active_prediction_id?: unknown;
      active_metric_id?: unknown;
    } | null;
    if (!reportRow) return null;
    const activationId = reportRow.active_activation_id;
    const decisionId = reportRow.active_decision_id;
    const predictionId = reportRow.active_prediction_id;
    const primaryMetricId = reportRow.active_metric_id;
    if (
      !validUuid(activationId) ||
      !validUuid(decisionId) ||
      !validUuid(predictionId) ||
      !validUuid(primaryMetricId)
    ) {
      throw new Error("Current Decision Report pointers are inconsistent.");
    }

    const activationResponse = await sb.from("decision_report_activations")
      .select(
        "activation_id, report_id, decision_id, prediction_id, contract_version, metric_id, " +
          "action_ids, selected_action_source_ids, primary_lever_action_id",
      )
      .eq("scope_id", scopeId)
      .eq("activation_id", activationId)
      .eq("report_id", reportId)
      .maybeSingle();
    if (activationResponse.error) throw activationResponse.error;
    const activation = activationResponse.data as ActivationRow | null;
    if (
      !activation ||
      activation.activation_id !== activationId ||
      activation.report_id !== reportId ||
      activation.decision_id !== decisionId ||
      activation.prediction_id !== predictionId ||
      activation.metric_id !== primaryMetricId ||
      ![1, 2].includes(activation.contract_version) ||
      !Array.isArray(activation.action_ids) ||
      activation.action_ids.some((id) => !validUuid(id)) ||
      !Array.isArray(activation.selected_action_source_ids) ||
      !validUuid(activation.primary_lever_action_id) ||
      !activation.action_ids.includes(activation.primary_lever_action_id)
    ) {
      throw new Error("Current Decision Report activation audit is inconsistent.");
    }

    const [metricsResponse, bindingsResponse, packageResponse] = await Promise.all([
      sb.from("decision_report_activation_metrics")
        .select("metric_id")
        .eq("scope_id", scopeId)
        .eq("activation_id", activationId),
      sb.from("decision_report_activation_action_metrics")
        .select(
          "action_id, action_source_item_id, metric_id, " +
            "monitoring_expected_direction, monitoring_check_date",
        )
        .eq("scope_id", scopeId)
        .eq("activation_id", activationId),
      sb.from("decision_report_package_interventions")
        .select(
          "registered_primary_action_id, intervention_action_id, intervention_date, " +
            "included_action_ids, completed_at, package_hash",
        )
        .eq("scope_id", scopeId)
        .eq("activation_id", activationId)
        .maybeSingle(),
    ]);
    if (metricsResponse.error) throw metricsResponse.error;
    if (bindingsResponse.error) throw bindingsResponse.error;
    if (packageResponse.error) throw packageResponse.error;

    const selectedMetricRows = (metricsResponse.data ?? []) as unknown as Array<{
      metric_id: string;
    }>;
    const bindingRows = (bindingsResponse.data ?? []) as unknown as Array<{
      action_id: string;
      action_source_item_id: string;
      metric_id: string;
      monitoring_expected_direction: string | null;
      monitoring_check_date: string | null;
    }>;
    if (
      selectedMetricRows.length < 1 ||
      selectedMetricRows.length > 5 ||
      selectedMetricRows.some((row) => !validUuid(row.metric_id)) ||
      bindingRows.some((row) =>
        !validUuid(row.action_id) ||
        typeof row.action_source_item_id !== "string" ||
        row.action_source_item_id.trim() === "" ||
        !validUuid(row.metric_id) ||
        (
          row.monitoring_expected_direction !== null &&
          row.monitoring_expected_direction !== "INCREASE" &&
          row.monitoring_expected_direction !== "DECREASE"
        ) ||
        !validOptionalDate(row.monitoring_check_date)
      )
    ) {
      throw new Error("Current Decision Report normalized metric bindings are inconsistent.");
    }
    const selectedMetricIds = selectedMetricRows.map((row) => row.metric_id);
    const actionBindings: DecisionReportActionMetricBinding[] = bindingRows.map((row) => ({
      actionId: row.action_id,
      actionSourceItemId: row.action_source_item_id,
      metricId: row.metric_id,
      monitoringExpectedDirection:
        row.monitoring_expected_direction === "INCREASE" ||
          row.monitoring_expected_direction === "DECREASE"
          ? row.monitoring_expected_direction
          : null,
      monitoringCheckDate: row.monitoring_check_date,
    }));
    const boundActionIds = new Set(actionBindings.map((binding) => binding.actionId));
    const boundSourceIds = new Set(actionBindings.map((binding) => binding.actionSourceItemId));
    const selectedMetricSet = new Set(selectedMetricIds);
    const primaryBinding = actionBindings.find(
      (binding) => binding.actionId === activation.primary_lever_action_id,
    );
    if (
      selectedMetricIds.length < 1 ||
      new Set(selectedMetricIds).size !== selectedMetricIds.length ||
      !selectedMetricSet.has(primaryMetricId) ||
      actionBindings.length !== activation.action_ids.length ||
      boundActionIds.size !== activation.action_ids.length ||
      boundSourceIds.size !== activation.selected_action_source_ids.length ||
      activation.action_ids.some((id) => !boundActionIds.has(id)) ||
      activation.selected_action_source_ids.some((id) => !boundSourceIds.has(id)) ||
      actionBindings.some((binding) => !selectedMetricSet.has(binding.metricId)) ||
      primaryBinding?.metricId !== primaryMetricId
    ) {
      throw new Error("Current Decision Report normalized metric bindings are inconsistent.");
    }

    const packageRow = packageResponse.data as {
      registered_primary_action_id?: unknown;
      intervention_action_id?: unknown;
      intervention_date?: unknown;
      included_action_ids?: unknown;
      completed_at?: unknown;
      package_hash?: unknown;
    } | null;
    if (activation.contract_version === 1 && packageRow) {
      throw new Error("Legacy activation cannot have a decision package intervention.");
    }
    if (packageRow) {
      if (
        packageRow.registered_primary_action_id !== activation.primary_lever_action_id ||
        !validUuid(packageRow.intervention_action_id) ||
        !activation.action_ids.includes(packageRow.intervention_action_id) ||
        !Array.isArray(packageRow.included_action_ids) ||
        packageRow.included_action_ids.length !== activation.action_ids.length ||
        packageRow.included_action_ids.some((id, index) => id !== activation.action_ids[index]) ||
        typeof packageRow.intervention_date !== "string" ||
        typeof packageRow.completed_at !== "string" ||
        typeof packageRow.package_hash !== "string" ||
        !/^[0-9a-f]{64}$/.test(packageRow.package_hash)
      ) {
        throw new Error("Decision package intervention audit is inconsistent.");
      }
    }

    const interventionActionId = packageRow && validUuid(packageRow.intervention_action_id)
      ? packageRow.intervention_action_id
      : activation.contract_version === 1
        ? activation.primary_lever_action_id
        : null;
    return {
      activationId,
      reportId,
      decisionId,
      predictionId,
      contractVersion: activation.contract_version as 1 | 2,
      primaryMetricId,
      selectedMetricIds,
      actionIds: [...activation.action_ids],
      registeredPrimaryActionId: activation.primary_lever_action_id,
      actionBindings,
      causalObject: activation.contract_version === 2
        ? "decision_package"
        : "registered_primary_action",
      interventionActionId,
      interventionDate: packageRow?.intervention_date as string | undefined ?? null,
      packageCompletedAt: packageRow?.completed_at as string | undefined ?? null,
      packageHash: packageRow?.package_hash as string | undefined ?? null,
    };
  },
);
