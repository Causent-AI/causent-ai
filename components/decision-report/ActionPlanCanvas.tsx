"use client";

import Link from "next/link";
import { useRef } from "react";

import { ClaimEditor } from "@/components/decision-report/ClaimEditor";
import { PredictedImpactChart } from "@/components/decision-report/PredictedImpactChart";
import type { ActionExecutionPatch } from "@/components/decision-report/ImplementationSection";
import {
  ReportCanvasEditor,
  type ReportCanvasDocumentChange,
  type ReportCanvasSection,
  type ReportCanvasTitleChange,
} from "@/components/decision-report/rich-text/ReportCanvasEditor";
import {
  MAX_DECISION_REPORT_ACTIONS,
  MAX_DECISION_REPORT_SELECTED_METRICS,
  getClaimPortableRichTextDocument,
  portableRichTextFromPlainText,
  type DecisionReportV1,
  type DraftAction,
  type MetricProjection,
} from "@/lib/decision-reports/schema";
import type { ReportActivationMetric } from "@/lib/decision-reports/materialization";
import {
  formatMetricReadinessDetail,
  isSupportingActionForMonitoring,
} from "@/lib/decision-reports/action-plan-ui";

type ActionMonitoringDirection = "INCREASE" | "DECREASE" | null;

function commaList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function priorityLabel(priority: number): string {
  return priority === 3
    ? "High"
    : priority === 2
      ? "Medium"
      : "Low";
}

function readinessClasses(readiness: ReportActivationMetric["readiness"]): string {
  return readiness === "Ready to monitor"
    ? "border-teal-200 bg-teal-50 text-teal-900"
    : readiness === "Needs data"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-blue-200 bg-blue-50 text-blue-900";
}

function AudienceClaimEditor({
  claims,
  label,
  singular,
  readOnly,
  onChange,
  onAdd,
}: {
  claims: DecisionReportV1["implementation"]["customers"];
  label: "Customers" | "Stakeholders";
  singular: "customer" | "stakeholder";
  readOnly: boolean;
  onChange: (claimId: string, text: string) => void;
  onAdd: (text: string) => void;
}) {
  const emptyDraftId = `user-${singular}-draft`;
  const visibleClaims = claims.length === 0
    ? [{
        id: emptyDraftId,
        text: "",
        status: "missing" as const,
        sourceChunkIds: [],
      }]
    : claims;

  if (readOnly && claims.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">{label}</p>
      {visibleClaims.map((claim) => (
        <ClaimEditor
          key={claim.id}
          claim={claim}
          label={label}
          optional
          readOnly={readOnly}
          onChange={(text) => {
            if (claims.length === 0) {
              onAdd(text);
              return;
            }
            onChange(claim.id, text);
          }}
        />
      ))}
      {!readOnly && claims.length > 0 && claims.length < 3 ? (
        <button
          type="button"
          className="min-h-11 self-start rounded-lg px-2 text-[11px] font-semibold text-[var(--brand-teal)] hover:bg-teal-50"
          onClick={() => onAdd("")}
        >
          Add {singular}
        </button>
      ) : null}
    </div>
  );
}

function MetricSelector({
  metrics,
  selectedMetricIds,
  primaryMetricId,
  reportId,
  readOnly,
  onMetricToggle,
  onPrimaryMetricChange,
}: {
  metrics: ReportActivationMetric[];
  selectedMetricIds: string[];
  primaryMetricId: string;
  reportId: string | null;
  readOnly: boolean;
  onMetricToggle: (metricId: string) => void;
  onPrimaryMetricChange: (metricId: string) => void;
}) {
  return (
    <div id="report-core-metrics" className="bg-slate-50/65 px-5 py-5" aria-label="Core metrics">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">Core Metrics</h3>
        {!readOnly ? (
          <Link
            href={`/data-workshop${reportId ? `?returnTo=${encodeURIComponent(`/onboarding?report=${reportId}`)}` : ""}`}
            className="inline-flex min-h-11 items-center rounded-lg px-2 text-[11px] font-semibold text-[var(--brand-blue)] hover:bg-blue-50"
          >
            Manage metrics
          </Link>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {metrics.map((metric) => {
          const selected = selectedMetricIds.includes(metric.metricId);
          const disabled = readOnly ||
            (!selected && selectedMetricIds.length >= MAX_DECISION_REPORT_SELECTED_METRICS);
          return (
            <div
              key={metric.metricId}
              className={`flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2.5 ${selected ? "border-teal-300 bg-white" : "border-[var(--border)] bg-white/70"}`}
            >
              <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 text-[12px] font-semibold text-[var(--text)]">
                <input
                  id={`core-metric-${metric.metricId}`}
                  type="checkbox"
                  checked={selected}
                  disabled={disabled}
                  onChange={() => onMetricToggle(metric.metricId)}
                />
                <span className="truncate">{metric.name}</span>
              </label>
              <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${readinessClasses(metric.readiness)}`}>
                {metric.readiness}
              </span>
              {selected ? (
                <label className="flex min-h-11 cursor-pointer items-center gap-1 text-[10px] font-semibold text-teal-800">
                  <input
                    id={`primary-metric-${metric.metricId}`}
                    type="radio"
                    name="primary-report-metric"
                    checked={primaryMetricId === metric.metricId}
                    disabled={readOnly}
                    onChange={() => onPrimaryMetricChange(metric.metricId)}
                  />
                  Primary outcome
                </label>
              ) : null}
              <p className="w-full pl-6 text-[10px] leading-4 text-[var(--text-muted)]">
                {formatMetricReadinessDetail(metric)}
              </p>
            </div>
          );
        })}
      </div>
      {metrics.length === 0 ? (
        <Link
          id="core-metrics-manage"
          href={`/data-workshop${reportId ? `?returnTo=${encodeURIComponent(`/onboarding?report=${reportId}`)}` : ""}`}
          className="mt-3 inline-flex min-h-11 items-center rounded-lg px-2 text-[12px] font-semibold text-[var(--brand-blue)] hover:bg-blue-50"
        >
          Add a metric
        </Link>
      ) : null}
    </div>
  );
}

function DecisionCommitment({
  metrics,
  actions,
  primaryMetricId,
  primaryActionId,
  direction,
  magnitudePctMean,
  resolutionDate,
  activationDateBounds,
  readOnly,
  onPrimaryActionChange,
  onDirectionChange,
  onMagnitudeChange,
  onResolutionDateChange,
}: {
  metrics: ReportActivationMetric[];
  actions: DraftAction[];
  primaryMetricId: string;
  primaryActionId: string;
  direction: "POSITIVE" | "NEGATIVE";
  magnitudePctMean: number | null;
  resolutionDate: string;
  activationDateBounds: { today: string; minimum: string };
  readOnly: boolean;
  onPrimaryActionChange: (sourceItemId: string) => void;
  onDirectionChange: (direction: "POSITIVE" | "NEGATIVE") => void;
  onMagnitudeChange: (magnitudePctMean: number | null) => void;
  onResolutionDateChange: (resolutionDate: string | null) => void;
}) {
  const primaryMetric = metrics.find(
    (metric) => metric.metricId === primaryMetricId,
  );
  const magnitudeMissing =
    magnitudePctMean === null ||
    !Number.isFinite(magnitudePctMean) ||
    magnitudePctMean <= 0;
  const resolutionDateMissing =
    !/^\d{4}-\d{2}-\d{2}$/.test(resolutionDate) ||
    resolutionDate <= activationDateBounds.today;

  return (
    <section
      id="report-decision-commitment"
      className="border-t border-[var(--border)] bg-white px-5 py-5"
      aria-labelledby="decision-commitment-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id="decision-commitment-title"
          className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]"
        >
          Decision commitment
        </h3>
        <span className="rounded-full bg-teal-50 px-2.5 py-1 text-[10px] font-semibold text-teal-800">
          {primaryMetric?.name ?? "Choose an outcome"}
        </span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label
          className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle)]"
          htmlFor="commitment-primary-action"
        >
          Primary action
          <select
            id="commitment-primary-action"
            className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-[12px] font-medium normal-case tracking-normal text-[var(--text)] outline-none focus:border-[var(--brand-blue)]"
            value={primaryActionId}
            disabled={readOnly}
            onChange={(event) => onPrimaryActionChange(event.target.value)}
          >
            <option value="">Select action</option>
            {actions.map((action) => (
              <option key={action.sourceItemId} value={action.sourceItemId}>
                {action.title}
              </option>
            ))}
          </select>
        </label>
        <label
          className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle)]"
          htmlFor="commitment-direction"
        >
          Direction
          <select
            id="commitment-direction"
            className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-[12px] font-medium normal-case tracking-normal text-[var(--text)] outline-none focus:border-[var(--brand-blue)]"
            value={direction}
            disabled={readOnly}
            onChange={(event) =>
              onDirectionChange(event.target.value as "POSITIVE" | "NEGATIVE")
            }
          >
            <option value="POSITIVE">Increase</option>
            <option value="NEGATIVE">Decrease</option>
          </select>
        </label>
        <label
          className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle)]"
          htmlFor="commitment-magnitude"
        >
          Expected change
          <span className="relative mt-1 block">
            <input
              id="commitment-magnitude"
              className={`min-h-11 w-full rounded-lg border bg-white px-3 pr-8 text-[12px] font-medium normal-case tracking-normal text-[var(--text)] outline-none focus:border-[var(--brand-blue)] ${magnitudeMissing ? "border-amber-400 bg-amber-50" : "border-[var(--border)]"}`}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.1"
              value={magnitudePctMean ?? ""}
              disabled={readOnly}
              aria-invalid={magnitudeMissing}
              onChange={(event) =>
                onMagnitudeChange(
                  event.target.value === "" ? null : Number(event.target.value),
                )
              }
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[var(--text-muted)]">
              %
            </span>
          </span>
        </label>
        <label
          className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle)]"
          htmlFor="commitment-date"
        >
          Resolution date
          <input
            id="commitment-date"
            className={`mt-1 block min-h-11 w-full rounded-lg border bg-white px-3 text-[12px] font-medium normal-case tracking-normal text-[var(--text)] outline-none focus:border-[var(--brand-blue)] ${resolutionDateMissing ? "border-amber-400 bg-amber-50" : "border-[var(--border)]"}`}
            type="date"
            min={activationDateBounds.minimum}
            value={resolutionDate}
            disabled={readOnly}
            aria-invalid={resolutionDateMissing}
            onChange={(event) =>
              onResolutionDateChange(event.target.value || null)
            }
          />
        </label>
      </div>
    </section>
  );
}

function ActionPlanReview({
  report,
  metrics,
  selectedMetricIds,
  primaryMetricId,
  primaryActionId,
  direction,
  magnitudePctMean,
  resolutionDate,
  actionTitleDrafts,
}: {
  report: DecisionReportV1;
  metrics: ReportActivationMetric[];
  selectedMetricIds: string[];
  primaryMetricId: string;
  primaryActionId: string;
  direction: "POSITIVE" | "NEGATIVE";
  magnitudePctMean: number | null;
  resolutionDate: string;
  actionTitleDrafts: Record<string, string>;
}) {
  const metricById = new Map(metrics.map((metric) => [metric.metricId, metric]));
  const primaryMetric = metricById.get(primaryMetricId);
  const primaryAction = report.implementation.actions.find(
    (action) => action.sourceItemId === primaryActionId,
  );
  const selectedMetrics = new Set(selectedMetricIds);

  return (
    <section
      className="mt-5 overflow-hidden rounded-xl border border-[var(--border)] bg-white"
      aria-labelledby="activation-review-title"
    >
      <div className="grid gap-4 border-b border-[var(--border)] px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--brand-teal)]">
            Primary outcome
          </p>
          <h3 id="activation-review-title" className="mt-1 text-[18px] font-semibold text-[var(--text)]">
            {primaryMetric?.name ?? "Outcome not selected"}
          </h3>
          <p className="mt-1 text-[12px] font-medium text-[var(--text-muted)]">
            {magnitudePctMean && magnitudePctMean > 0
              ? `${direction === "POSITIVE" ? "+" : "−"}${magnitudePctMean}%`
              : "—"}
            {resolutionDate ? ` by ${resolutionDate}` : ""}
          </p>
        </div>
        <div className="sm:text-right">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-subtle)]">
            Primary action
          </p>
          <p className="mt-1 text-[12px] font-semibold text-[var(--text)]">
            {primaryAction
              ? actionTitleDrafts[primaryAction.sourceItemId] ?? primaryAction.title
              : "Not selected"}
          </p>
        </div>
      </div>
      <ul className="divide-y divide-[var(--border)]" aria-label="Action metric assignments">
        {report.implementation.actions.map((action) => {
          const metricId = action.sourceItemId === primaryActionId
            ? primaryMetricId
            : action.metricId ?? primaryMetricId;
          const metric = selectedMetrics.has(metricId)
            ? metricById.get(metricId)
            : undefined;
          return (
            <li
              key={action.sourceItemId}
              className="grid min-h-11 gap-1 px-4 py-2.5 text-[12px] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <span className="min-w-0 truncate font-medium text-[var(--text)]">
                {actionTitleDrafts[action.sourceItemId] ?? action.title}
              </span>
              <span className={`font-semibold ${metric ? "text-teal-800" : "text-amber-800"}`}>
                {metric?.name ?? "Metric needed"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ActionControls({
  action,
  index,
  metrics,
  selectedMetricIds,
  primaryMetricId,
  primaryActionId,
  displayTitle,
  included,
  readOnly,
  exactSavedRevision,
  startReady,
  startPendingActionId,
  activeDecisionId,
  onActionMetricChange,
  onPrimaryActionChange,
  onActionOwnerChange,
  onActionMonitoringChange,
  onActionExecutionChange,
  onActionRemove,
  onStartAction,
}: {
  action: DraftAction;
  index: number;
  metrics: ReportActivationMetric[];
  selectedMetricIds: string[];
  primaryMetricId: string;
  primaryActionId: string;
  displayTitle: string;
  included: boolean;
  readOnly: boolean;
  exactSavedRevision: boolean;
  startReady: boolean;
  startPendingActionId: string | null;
  activeDecisionId: string | null;
  onActionMetricChange: (sourceItemId: string, metricId: string | null) => void;
  onPrimaryActionChange: (sourceItemId: string) => void;
  onActionOwnerChange: (sourceItemId: string, text: string) => void;
  onActionMonitoringChange: (
    sourceItemId: string,
    expectedDirection: ActionMonitoringDirection,
    checkDate: string | null,
  ) => void;
  onActionExecutionChange: (sourceItemId: string, patch: ActionExecutionPatch) => void;
  onActionRemove: (sourceItemId: string) => void;
  onStartAction?: (sourceItemId: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const priority = action.priority ?? Math.max(1, 3 - index);
  const actionMetricId = action.metricId ?? primaryMetricId;
  const metricMissing = !actionMetricId || !selectedMetricIds.includes(actionMetricId);
  const selectedMetrics = metrics.filter((metric) =>
    selectedMetricIds.includes(metric.metricId),
  );
  const primary = primaryActionId === action.sourceItemId;
  const pending = startPendingActionId !== null;
  const canStart = Boolean(onStartAction) &&
    included &&
    (activeDecisionId !== null || (exactSavedRevision && startReady)) &&
    !pending;

  function closeDetails() {
    dialogRef.current?.close();
  }

  return (
    <div className="bg-slate-50/65 px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <label
          className={`inline-flex min-h-11 min-w-0 items-center rounded-full border bg-white pl-3 text-[10px] font-semibold text-[var(--text-subtle)] ${metricMissing ? "border-amber-400 bg-amber-50" : "border-[var(--border)]"}`}
          htmlFor={`action-metric-${action.sourceItemId}`}
        >
          {primary ? "Outcome" : "Metric"}
          <select
            id={`action-metric-${action.sourceItemId}`}
            className="min-h-11 min-w-0 max-w-48 rounded-full border-0 bg-transparent px-2 text-[11px] font-semibold text-[var(--text)] outline-none"
            value={actionMetricId}
            disabled={readOnly || primary}
            aria-invalid={metricMissing}
            onChange={(event) =>
              onActionMetricChange(
                action.sourceItemId,
                event.target.value || null,
              )
            }
          >
            <option value="">Select metric</option>
            {selectedMetrics.map((metric) => (
              <option key={metric.metricId} value={metric.metricId}>{metric.name}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`min-h-11 rounded-full border px-3 text-[11px] font-semibold ${primary ? "border-teal-300 bg-teal-50 text-teal-900" : "border-[var(--border)] bg-white text-[var(--text-muted)]"}`}
          aria-pressed={primary}
          disabled={readOnly}
          onClick={() => onPrimaryActionChange(action.sourceItemId)}
        >
          {primary ? "Primary action" : "Set primary"}
        </button>
        {readOnly && !included ? (
          <span className="inline-flex min-h-11 items-center rounded-full bg-slate-100 px-3 text-[10px] font-semibold text-[var(--text-subtle)]">
            Not activated
          </span>
        ) : null}
        <button
          type="button"
          className="min-h-11 rounded-full border border-[var(--border)] bg-white px-3 text-[11px] font-semibold text-[var(--text)]"
          onClick={() => dialogRef.current?.showModal()}
        >
          Details
        </button>
        <button
          id={`action-start-${action.sourceItemId}`}
          type="button"
          className="ml-auto min-h-11 rounded-full bg-[var(--text)] px-4 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canStart}
          onClick={() => onStartAction?.(action.sourceItemId)}
        >
          {startPendingActionId === action.sourceItemId
            ? activeDecisionId
              ? "Opening…"
              : "Starting…"
            : activeDecisionId
              ? "Open"
              : "Start"}
        </button>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby={`action-details-title-${action.sourceItemId}`}
        className="fixed inset-y-0 right-0 m-0 ml-auto h-dvh max-h-dvh w-full max-w-md overflow-y-auto border-0 bg-white p-0 text-[var(--text)] shadow-2xl backdrop:bg-slate-950/35 sm:rounded-l-2xl"
        onCancel={closeDetails}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDetails();
        }}
      >
        <div className="flex min-h-full flex-col">
          <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--border)] bg-white px-5 py-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">
                Action {index + 1}
              </p>
              <h3
                id={`action-details-title-${action.sourceItemId}`}
                className="mt-1 text-[17px] font-semibold leading-6"
              >
                {displayTitle || "Untitled action"}
              </h3>
            </div>
            <button
              type="button"
              className="min-h-11 min-w-11 rounded-full border border-[var(--border)] text-[18px] text-[var(--text-muted)]"
              aria-label="Close action details"
              onClick={closeDetails}
            >
              ×
            </button>
          </header>
          <div className="grid flex-1 gap-4 px-5 py-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-[11px] font-semibold text-[var(--text-muted)]" htmlFor={`action-owner-${action.sourceItemId}`}>
              Owner
              <input
                id={`action-owner-${action.sourceItemId}`}
                className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-[12px] text-[var(--text)] outline-none focus:border-[var(--brand-blue)]"
                value={action.owner?.text ?? ""}
                disabled={readOnly}
                onChange={(event) =>
                  onActionOwnerChange(action.sourceItemId, event.target.value)
                }
              />
            </label>
            <label className="text-[11px] font-semibold text-[var(--text-muted)]" htmlFor={`action-time-${action.sourceItemId}`}>
              Time
              <input
                id={`action-time-${action.sourceItemId}`}
                className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-[12px] text-[var(--text)] outline-none focus:border-[var(--brand-blue)]"
                value={action.estimatedTime ?? ""}
                disabled={readOnly}
                onChange={(event) =>
                  onActionExecutionChange(action.sourceItemId, {
                    estimatedTime: event.target.value,
                  })
                }
              />
            </label>
            <label className="text-[11px] font-semibold text-[var(--text-muted)]" htmlFor={`action-cost-${action.sourceItemId}`}>
              Cost
              <input
                id={`action-cost-${action.sourceItemId}`}
                className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-[12px] text-[var(--text)] outline-none focus:border-[var(--brand-blue)]"
                value={action.estimatedCost ?? ""}
                disabled={readOnly}
                onChange={(event) =>
                  onActionExecutionChange(action.sourceItemId, {
                    estimatedCost: event.target.value,
                  })
                }
              />
            </label>
          </div>
          {isSupportingActionForMonitoring(action.sourceItemId, primaryActionId) ? (
            <fieldset className="border-t border-[var(--border)] pt-3">
              <legend className="px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle)]">
                Monitoring context (optional)
              </legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label
                  className="text-[11px] font-semibold text-[var(--text-muted)]"
                  htmlFor={`action-monitoring-direction-${action.sourceItemId}`}
                >
                  Expected direction
                  <select
                    id={`action-monitoring-direction-${action.sourceItemId}`}
                    className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-[12px] text-[var(--text)] outline-none focus:border-[var(--brand-blue)]"
                    value={action.monitoringExpectedDirection ?? ""}
                    disabled={readOnly}
                    onChange={(event) => {
                      const expectedDirection = event.target.value === "INCREASE" ||
                          event.target.value === "DECREASE"
                        ? event.target.value
                        : null;
                      onActionMonitoringChange(
                        action.sourceItemId,
                        expectedDirection,
                        action.monitoringCheckDate ?? null,
                      );
                    }}
                  >
                    <option value="">Not set</option>
                    <option value="INCREASE">Increase</option>
                    <option value="DECREASE">Decrease</option>
                  </select>
                </label>
                <label
                  className="text-[11px] font-semibold text-[var(--text-muted)]"
                  htmlFor={`action-monitoring-date-${action.sourceItemId}`}
                >
                  Check date
                  <input
                    id={`action-monitoring-date-${action.sourceItemId}`}
                    type="date"
                    className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-[12px] text-[var(--text)] outline-none focus:border-[var(--brand-blue)]"
                    value={action.monitoringCheckDate ?? ""}
                    disabled={readOnly}
                    onChange={(event) =>
                      onActionMonitoringChange(
                        action.sourceItemId,
                        action.monitoringExpectedDirection ?? null,
                        event.target.value || null,
                      )
                    }
                  />
                </label>
              </div>
            </fieldset>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[11px] font-semibold text-[var(--text-muted)]" htmlFor={`action-tags-${action.sourceItemId}`}>
              Tags
              <input
                id={`action-tags-${action.sourceItemId}`}
                className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-[12px] text-[var(--text)] outline-none focus:border-[var(--brand-blue)]"
                defaultValue={(action.tags ?? []).join(", ")}
                disabled={readOnly}
                onChange={(event) =>
                  onActionExecutionChange(action.sourceItemId, {
                    tags: commaList(event.target.value),
                  })
                }
              />
            </label>
            <label className="text-[11px] font-semibold text-[var(--text-muted)]" htmlFor={`action-skills-${action.sourceItemId}`}>
              Skills
              <input
                id={`action-skills-${action.sourceItemId}`}
                className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-[12px] text-[var(--text)] outline-none focus:border-[var(--brand-blue)]"
                defaultValue={(action.skills ?? []).join(", ")}
                disabled={readOnly}
                onChange={(event) =>
                  onActionExecutionChange(action.sourceItemId, {
                    skills: commaList(event.target.value),
                  })
                }
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-[var(--text-muted)]">{priorityLabel(priority)}</span>
              <div className="flex" aria-label={`Priority: ${priority} of 3`}>
                {[1, 2, 3].map((star) => (
                  <button
                    key={star}
                    type="button"
                    disabled={readOnly}
                    aria-label={`Set priority to ${star}`}
                    onClick={() =>
                      onActionExecutionChange(action.sourceItemId, {
                        priority: star as 1 | 2 | 3,
                      })
                    }
                    className={`min-h-11 min-w-11 text-[18px] ${star <= priority ? "text-amber-500" : "text-slate-300"}`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
            {!readOnly ? (
              <button
                type="button"
                className="min-h-11 rounded-lg px-2 text-[11px] font-semibold text-red-700 hover:bg-red-50"
                onClick={() => {
                  closeDetails();
                  onActionRemove(action.sourceItemId);
                }}
              >
                Remove action
              </button>
            ) : null}
          </div>
        </div>
        </div>
      </dialog>
    </div>
  );
}

export function ActionPlanCanvas({
  report,
  projection,
  metrics,
  selectedMetricIds,
  primaryMetricId,
  primaryActionId,
  includedActionIds,
  reportId,
  readOnly,
  actionTitleDrafts,
  invalidActionTitleIds,
  direction,
  magnitudePctMean,
  resolutionDate,
  activationDateBounds,
  exactSavedRevision,
  startReady,
  startPendingActionId = null,
  startError = null,
  activeDecisionId = null,
  activationCommittedAt = null,
  onDocumentsChange,
  onMetricToggle,
  onPrimaryMetricChange,
  onActionMetricChange,
  onActionTitleChange,
  onActionOwnerChange,
  onActionMonitoringChange,
  onActionExecutionChange,
  onPrimaryActionChange,
  onActionAdd,
  onActionRemove,
  onClaimChange,
  onCustomerAdd,
  onStakeholderAdd,
  onDirectionChange,
  onMagnitudeChange,
  onResolutionDateChange,
  onStartAction,
}: {
  report: DecisionReportV1;
  projection: MetricProjection;
  metrics: ReportActivationMetric[];
  selectedMetricIds: string[];
  primaryMetricId: string;
  primaryActionId: string;
  includedActionIds: string[];
  reportId: string | null;
  readOnly: boolean;
  actionTitleDrafts: Record<string, string>;
  invalidActionTitleIds: string[];
  direction: "POSITIVE" | "NEGATIVE";
  magnitudePctMean: number | null;
  resolutionDate: string;
  activationDateBounds: { today: string; minimum: string };
  exactSavedRevision: boolean;
  startReady: boolean;
  startPendingActionId?: string | null;
  startError?: string | null;
  activeDecisionId?: string | null;
  activationCommittedAt?: string | null;
  onDocumentsChange: (changes: ReportCanvasDocumentChange[]) => void;
  onMetricToggle: (metricId: string) => void;
  onPrimaryMetricChange: (metricId: string) => void;
  onActionMetricChange: (sourceItemId: string, metricId: string | null) => void;
  onActionTitleChange: (sourceItemId: string, title: string) => void;
  onActionOwnerChange: (sourceItemId: string, text: string) => void;
  onActionMonitoringChange: (
    sourceItemId: string,
    expectedDirection: ActionMonitoringDirection,
    checkDate: string | null,
  ) => void;
  onActionExecutionChange: (sourceItemId: string, patch: ActionExecutionPatch) => void;
  onPrimaryActionChange: (sourceItemId: string) => void;
  onActionAdd: () => void;
  onActionRemove: (sourceItemId: string) => void;
  onClaimChange: (claimId: string, text: string) => void;
  onCustomerAdd: (text: string) => void;
  onStakeholderAdd: (text: string) => void;
  onDirectionChange: (direction: "POSITIVE" | "NEGATIVE") => void;
  onMagnitudeChange: (magnitudePctMean: number | null) => void;
  onResolutionDateChange: (resolutionDate: string | null) => void;
  onStartAction?: (sourceItemId: string) => void;
}) {
  const implementation = report.implementation;
  const planSummary = implementation.actionPlanSummary[0];
  const primaryMetric = metrics.find(
    (metric) => metric.metricId === primaryMetricId,
  );
  const activationDate = activationCommittedAt?.slice(0, 10) ?? null;
  const hasCommitmentBaseline =
    !readOnly ||
    activationDate === null ||
    primaryMetric?.lastObservationDate === null ||
    (primaryMetric?.lastObservationDate ?? "") <= activationDate;
  const metricSlot = (
    <>
      <MetricSelector
        metrics={metrics}
        selectedMetricIds={selectedMetricIds}
        primaryMetricId={primaryMetricId}
        reportId={reportId}
        readOnly={readOnly}
        onMetricToggle={onMetricToggle}
        onPrimaryMetricChange={onPrimaryMetricChange}
      />
      <DecisionCommitment
        metrics={metrics}
        actions={implementation.actions}
        primaryMetricId={primaryMetricId}
        primaryActionId={primaryActionId}
        direction={direction}
        magnitudePctMean={magnitudePctMean}
        resolutionDate={resolutionDate}
        activationDateBounds={activationDateBounds}
        readOnly={readOnly}
        onPrimaryActionChange={onPrimaryActionChange}
        onDirectionChange={onDirectionChange}
        onMagnitudeChange={onMagnitudeChange}
        onResolutionDateChange={onResolutionDateChange}
      />
    </>
  );
  const sections: ReportCanvasSection[] = [
    {
      claimId: planSummary.id,
      label: "Action Plan Summary",
      document: getClaimPortableRichTextDocument(report, planSummary),
      invalid: planSummary.text.trim() === "",
      after: { slotId: "core-metrics", content: metricSlot },
    },
    ...implementation.actions.flatMap((action, index) => {
      const summary = action.summary[0];
      if (!summary) return [];
      const titleDraft = actionTitleDrafts[action.sourceItemId] ?? action.title;
      return [{
        claimId: summary.id,
        label: `Action ${index + 1}`,
        editableTitle: {
          titleId: action.sourceItemId,
          value: titleDraft,
          label: `Action ${index + 1} title`,
          invalid: invalidActionTitleIds.includes(action.sourceItemId),
        },
        document: summary
          ? getClaimPortableRichTextDocument(report, summary)
          : portableRichTextFromPlainText(""),
        after: {
          slotId: `action-controls:${action.sourceItemId}`,
          content: (
            <ActionControls
              action={action}
              index={index}
              metrics={metrics}
              selectedMetricIds={selectedMetricIds}
              primaryMetricId={primaryMetricId}
              primaryActionId={primaryActionId}
              displayTitle={titleDraft}
              included={includedActionIds.includes(action.sourceItemId)}
              readOnly={readOnly}
              exactSavedRevision={exactSavedRevision}
              startReady={startReady}
              startPendingActionId={startPendingActionId}
              activeDecisionId={activeDecisionId}
              onActionMetricChange={onActionMetricChange}
              onPrimaryActionChange={onPrimaryActionChange}
              onActionOwnerChange={onActionOwnerChange}
              onActionMonitoringChange={onActionMonitoringChange}
              onActionExecutionChange={onActionExecutionChange}
              onActionRemove={onActionRemove}
              onStartAction={onStartAction}
            />
          ),
        },
      }];
    }),
  ];

  return (
    <section className="border-t border-[var(--border)] px-5 py-8 sm:px-9 sm:py-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--brand-blue)]">02</p>
          <h2 className="mt-2 text-[24px] font-semibold tracking-[-0.02em] text-[var(--text)]">Action Plan</h2>
        </div>
        {!readOnly ? (
          <button
            type="button"
            className="min-h-11 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-[11px] font-semibold text-[var(--text)] disabled:opacity-40"
            disabled={implementation.actions.length >= MAX_DECISION_REPORT_ACTIONS}
            onClick={onActionAdd}
          >
            Add action
          </button>
        ) : null}
      </div>

      <PredictedImpactChart
        projection={projection}
        statusLabel={readOnly ? "Activated commitment" : "Draft commitment"}
        liveCommitment={{
          metricSelected: primaryMetric !== undefined,
          metricName: primaryMetric?.name ?? "Outcome metric",
          baselineNative: hasCommitmentBaseline
            ? primaryMetric?.lastObservationValue ?? null
            : null,
          baselineDate: hasCommitmentBaseline
            ? primaryMetric?.lastObservationDate ?? null
            : null,
          baselineUnavailableLabel: readOnly && !hasCommitmentBaseline
            ? "Commitment baseline unavailable here"
            : undefined,
          format: primaryMetric?.format ?? "percent",
          percentScale: primaryMetric?.percentScale ?? "ratio",
          direction,
          magnitudePctMean,
        }}
      />

      <div className="mt-5">
        <ReportCanvasEditor
          canvasId="action-plan-editor"
          label="Action plan"
          sections={sections}
          readOnly={readOnly}
          onChange={onDocumentsChange}
          onTitleChange={(changes: ReportCanvasTitleChange[]) => {
            for (const change of changes) {
              onActionTitleChange(change.titleId, change.value);
            }
          }}
        />
      </div>

      <ActionPlanReview
        report={report}
        metrics={metrics}
        selectedMetricIds={selectedMetricIds}
        primaryMetricId={primaryMetricId}
        primaryActionId={primaryActionId}
        direction={direction}
        magnitudePctMean={magnitudePctMean}
        resolutionDate={resolutionDate}
        actionTitleDrafts={actionTitleDrafts}
      />

      {startError ? (
        <p
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800"
          role="alert"
        >
          {startError}
        </p>
      ) : null}

      {implementation.actions.length === 0 ? (
        <button
          id="report-actions-empty"
          type="button"
          className="mt-3 min-h-11 w-full rounded-xl border border-dashed border-amber-300 bg-amber-50/40 px-3 py-4 text-[12px] font-semibold text-amber-900"
          disabled={readOnly}
          onClick={onActionAdd}
        >
          Add first action
        </button>
      ) : null}

      <details className="mt-5 rounded-xl border border-[var(--border)] bg-slate-50/50 px-4 py-3">
        <summary className="cursor-pointer text-[12px] font-semibold text-[var(--text)]">Customers and stakeholders</summary>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <AudienceClaimEditor
            claims={implementation.customers}
            label="Customers"
            singular="customer"
            readOnly={readOnly}
            onChange={onClaimChange}
            onAdd={onCustomerAdd}
          />
          <AudienceClaimEditor
            claims={implementation.stakeholders}
            label="Stakeholders"
            singular="stakeholder"
            readOnly={readOnly}
            onChange={onClaimChange}
            onAdd={onStakeholderAdd}
          />
        </div>
      </details>
    </section>
  );
}
