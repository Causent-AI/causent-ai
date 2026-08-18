"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { activateDecisionReportAction } from "@/app/(onboarding)/onboarding/decision-report-activation-actions";
import type { ReportActivationActionMetricAssignment } from "@/lib/decision-reports/activation";
import type {
  DecisionReportActivationPointer,
  DecisionReportPersistenceStatus,
} from "@/lib/decision-reports/persistence";

type ActivationPersistence = {
  reportId: string;
  revisionId: string;
  status: DecisionReportPersistenceStatus;
  activation: DecisionReportActivationPointer | null;
};

export function ReportActivationPanel({
  persistence,
  hasUnsavedChanges,
  metricId,
  metricAvailable,
  selectedMetricIds,
  selectedActionIds,
  actionMetricAssignments,
  primaryActionId,
  direction,
  magnitudePctMean,
  resolutionDate,
  onDirectionChange,
  onMagnitudeChange,
  onResolutionDateChange,
  telemetrySessionKey,
  telemetryStartedAtMs,
  activationDateBounds,
}: {
  persistence: ActivationPersistence | null;
  hasUnsavedChanges: boolean;
  metricId: string;
  metricAvailable: boolean;
  selectedMetricIds: string[];
  selectedActionIds: string[];
  actionMetricAssignments: ReportActivationActionMetricAssignment[];
  primaryActionId: string;
  direction: "POSITIVE" | "NEGATIVE";
  magnitudePctMean: number | null;
  resolutionDate: string;
  onDirectionChange: (direction: "POSITIVE" | "NEGATIVE") => void;
  onMagnitudeChange: (magnitudePctMean: number | null) => void;
  onResolutionDateChange: (resolutionDate: string | null) => void;
  telemetrySessionKey: string;
  telemetryStartedAtMs: number;
  activationDateBounds: { today: string; minimum: string };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (persistence?.status === "active" && persistence.activation) {
    return (
      <section
        className="rounded-2xl border border-teal-200 bg-teal-50/70 p-4 sm:p-5"
        aria-labelledby="activation-title"
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-teal-700">
          Decision activated
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="activation-title" className="text-[17px] font-semibold text-teal-950">
              This report is now tracked work
            </h2>
            <p className="mt-1 max-w-2xl text-[12px] leading-5 text-teal-900/80">
              The activated revision is locked.
            </p>
          </div>
          <Link
            href={`/actions?selected=${persistence.activation.decisionId}`}
            className="rounded-lg bg-teal-900 px-4 py-2 text-[12px] font-semibold text-white"
          >
            Open Actions &amp; Decisions
          </Link>
        </div>
      </section>
    );
  }

  const exactSavedRevision =
    persistence?.status === "report_ready" && !hasUnsavedChanges;
  const magnitudeMissing =
    magnitudePctMean === null ||
    !Number.isFinite(magnitudePctMean) ||
    magnitudePctMean <= 0;
  const resolutionDateMissing =
    !/^\d{4}-\d{2}-\d{2}$/.test(resolutionDate) ||
    resolutionDate <= activationDateBounds.today;
  const actionsMissing = selectedActionIds.length === 0;
  const primaryMissing =
    selectedActionIds.length > 0 && !selectedActionIds.includes(primaryActionId);
  const metricsMissing =
    selectedMetricIds.length < 1 ||
    selectedMetricIds.length > 5 ||
    !selectedMetricIds.includes(metricId);
  const assignedActionIds = new Set(
    actionMetricAssignments.map((assignment) => assignment.actionSourceItemId),
  );
  const assignmentsMissing =
    actionMetricAssignments.length !== selectedActionIds.length ||
    assignedActionIds.size !== actionMetricAssignments.length ||
    selectedActionIds.some((actionId) => !assignedActionIds.has(actionId)) ||
    actionMetricAssignments.some(
      (assignment) => !selectedMetricIds.includes(assignment.metricId),
    );
  const primaryAssignmentMissing = actionMetricAssignments.find(
    (assignment) => assignment.actionSourceItemId === primaryActionId,
  )?.metricId !== metricId;
  const inputComplete =
    metricId !== "" &&
    metricAvailable &&
    !metricsMissing &&
    !assignmentsMissing &&
    !primaryAssignmentMissing &&
    !magnitudeMissing &&
    !resolutionDateMissing &&
    selectedActionIds.length >= 1 &&
    selectedActionIds.length <= 25 &&
    selectedActionIds.includes(primaryActionId);

  function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!persistence || !exactSavedRevision || !inputComplete) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await activateDecisionReportAction({
          schemaVersion: 2,
          reportId: persistence.reportId,
          revisionId: persistence.revisionId,
          confirmedMetricId: metricId,
          selectedMetricIds,
          prediction: {
            direction,
            magnitudePctMean: magnitudePctMean!,
            resolutionDate,
          },
          selectedActionSourceItemIds: selectedActionIds,
          actionMetricAssignments,
          primaryLeverActionSourceItemId: primaryActionId,
        }, {
          sessionKey: telemetrySessionKey,
          msSinceStart: Math.max(0, Math.round(performance.now() - telemetryStartedAtMs)),
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.push(`/actions?selected=${result.activation.decisionId}`);
      } catch {
        setError("Causent could not activate this report. No partial action plan was created—try again.");
      }
    });
  }

  return (
    <section
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm shadow-slate-200/40 sm:p-5"
      aria-labelledby="activation-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--brand-teal)]">
            Activate the plan
          </p>
          <h2 id="activation-title" className="mt-1 text-[17px] font-semibold text-[var(--text)]">
            Set the prediction
          </h2>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
          exactSavedRevision
            ? "bg-emerald-50 text-emerald-800"
            : "bg-amber-50 text-amber-800"
        }`}>
          {exactSavedRevision ? "Autosaved" : "Waiting for autosave"}
        </span>
      </div>

      <form className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end" onSubmit={activate}>
        <fieldset className="grid gap-3 rounded-xl border border-[var(--border)] p-3 sm:grid-cols-3" disabled={isPending}>
          <legend className="px-1 text-[11px] font-semibold text-[var(--text-subtle)]">
            Prediction
          </legend>
          <label className="text-[11px] font-medium text-[var(--text-muted)]" htmlFor="activation-direction">
            Expected direction
            <select
              id="activation-direction"
              className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-[12px]"
              value={direction}
              onChange={(event) => onDirectionChange(event.target.value as "POSITIVE" | "NEGATIVE")}
            >
              <option value="POSITIVE">Increase</option>
              <option value="NEGATIVE">Decrease</option>
            </select>
          </label>
          <label className="text-[11px] font-medium text-[var(--text-muted)]" htmlFor="activation-magnitude">
            Change (% of mean)
            <input
              id="activation-magnitude"
              className={`mt-1 block w-full rounded-lg border px-3 py-2 text-[12px] tabular-nums ${magnitudeMissing ? "border-amber-400 bg-amber-50/70" : "border-[var(--border)]"}`}
              aria-invalid={magnitudeMissing}
              inputMode="decimal"
              min="0"
              step="0.1"
              type="number"
              value={magnitudePctMean ?? ""}
              onChange={(event) =>
                onMagnitudeChange(
                  event.target.value === "" ? null : Number(event.target.value),
                )
              }
              placeholder="15"
            />
            {magnitudeMissing ? (
              <span className="mt-1 block text-[10px] font-medium text-amber-800">
                Enter the expected percentage change.
              </span>
            ) : null}
          </label>
          <label className="text-[11px] font-medium text-[var(--text-muted)]" htmlFor="activation-date">
            Resolution date
            <input
              id="activation-date"
              className={`mt-1 block w-full rounded-lg border px-3 py-2 text-[12px] ${resolutionDateMissing ? "border-amber-400 bg-amber-50/70" : "border-[var(--border)]"}`}
              aria-invalid={resolutionDateMissing}
              type="date"
              min={activationDateBounds.minimum}
              value={resolutionDate}
              onChange={(event) =>
                onResolutionDateChange(event.target.value || null)
              }
            />
            {resolutionDateMissing ? (
              <span className="mt-1 block text-[10px] font-medium text-amber-800">
                Choose a future resolution date.
              </span>
            ) : null}
          </label>
        </fieldset>
        <div className="flex flex-col items-stretch gap-2 lg:min-w-44">
          <p className={`text-[10px] ${actionsMissing || primaryMissing || metricsMissing || assignmentsMissing || primaryAssignmentMissing ? "font-semibold text-amber-800" : "text-[var(--text-muted)]"}`}>
            {actionsMissing
              ? "Add an action"
              : primaryMissing
                ? "Choose a primary action"
                : metricsMissing
                  ? "Choose a core metric"
                  : assignmentsMissing
                    ? "Assign a metric to every action"
                    : primaryAssignmentMissing
                      ? "Match the primary action to the outcome metric"
                      : `${selectedActionIds.length} ${selectedActionIds.length === 1 ? "action" : "actions"} ready`}
          </p>
          <button
            type="submit"
            className="rounded-lg bg-[var(--text)] px-4 py-2.5 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!exactSavedRevision || !inputComplete || isPending}
          >
            {isPending ? "Activating…" : "Activate decision"}
          </button>
        </div>
      </form>

      {error ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
