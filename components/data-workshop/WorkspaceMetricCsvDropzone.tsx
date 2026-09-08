"use client";

import { useActionState, useState } from "react";
import { FileCsvIcon } from "@/components/ui/icons";
import {
  importWorkspaceMetricCsvAction,
  type WorkspaceMetricCsvImportActionState,
} from "@/app/(dashboard)/data-workshop/server-actions";

const INITIAL_STATE: WorkspaceMetricCsvImportActionState = { status: "idle" };

/** Import or update a named workspace metric for Decision Report selection. */
export function WorkspaceMetricCsvDropzone({
  activeMetricName,
  activeMetricUnit,
}: {
  activeMetricName?: string | null;
  activeMetricUnit?: string | null;
}) {
  const [state, action, pending] = useActionState(importWorkspaceMetricCsvAction, INITIAL_STATE);
  const defaultUnit = activeMetricUnit === "percent" || activeMetricUnit === "USD"
    ? activeMetricUnit
    : "count";
  const [unit, setUnit] = useState(defaultUnit);
  const fieldClass = "mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-base text-[var(--text)] outline-none focus:border-[var(--brand-blue)] md:text-[12px]";

  return (
    <section aria-labelledby="workspace-metric-import-title">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)]">
          <FileCsvIcon />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="workspace-metric-import-title" className="text-[15px] font-semibold text-[var(--text)]">Add a core metric</h2>
          {activeMetricName ? <p className="mt-1 text-[11px] text-[var(--text-muted)]">Current report metric: <span className="font-semibold text-[var(--text)]">{activeMetricName}</span></p> : null}
        </div>
      </div>

      <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2 sm:items-end">
        <label className="text-[11px] font-medium text-[var(--text-muted)]" htmlFor="workspace-metric-name">
          Metric name
          <input
            id="workspace-metric-name"
            name="metricName"
            required
            maxLength={120}
            defaultValue={activeMetricName ?? undefined}
            placeholder="e.g. AI assistant adoption rate"
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-base text-[var(--text)] outline-none focus:border-[var(--brand-blue)] md:text-[12px]"
          />
        </label>
        <label className="text-[11px] font-medium text-[var(--text-muted)]" htmlFor="workspace-metric-unit">
          Unit
          <select
            id="workspace-metric-unit"
            name="unit"
            value={unit}
            onChange={(event) => setUnit(event.target.value as typeof defaultUnit)}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-base text-[var(--text)] outline-none focus:border-[var(--brand-blue)] md:text-[12px]"
          >
            <option value="percent">Percent</option>
            <option value="count">Count</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <label className="text-[11px] font-medium text-[var(--text-muted)]" htmlFor="workspace-metric-csv">
          CSV file
          <input
            id="workspace-metric-csv"
            name="csv"
            required
            type="file"
            accept=".csv,text/csv"
            disabled={pending}
            className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-white px-2 py-[6px] text-[11px] text-[var(--text-muted)] file:mr-2 file:rounded-md file:border-0 file:bg-[var(--brand-blue)] file:px-2 file:py-1 file:text-[11px] file:font-semibold file:text-white"
          />
        </label>
        {unit === "percent" ? (
          <label className="text-[11px] font-medium text-[var(--text-muted)]">
            How are percentages stored?
            <select key={unit} name="numericScale" required defaultValue="" className={fieldClass}>
              <option value="">Choose a scale</option>
              <option value="points">0.5 means 0.5%</option>
              <option value="ratio">0.5 means 50%</option>
            </select>
          </label>
        ) : <input type="hidden" name="numericScale" value="native" />}
        <label className="text-[11px] font-medium text-[var(--text-muted)]">
          Which direction is better?
          <select name="beneficialDirection" required defaultValue="" className={fieldClass}>
            <option value="">Choose a direction</option>
            <option value="higher">Higher is better</option>
            <option value="lower">Lower is better</option>
            <option value="neutral">No preferred direction</option>
          </select>
        </label>
        <label className="text-[11px] font-medium text-[var(--text-muted)]">
          What does each daily value represent?
          <select name="aggregation" required defaultValue="" className={fieldClass}>
            <option value="">Choose a daily measure</option>
            <option value="sum">Total</option>
            <option value="mean">Average</option>
            <option value="rate">Rate</option>
            <option value="snapshot">Snapshot</option>
          </select>
        </label>
        <label className="text-[11px] font-medium text-[var(--text-muted)]">
          Population or denominator
          <input name="denominator" required maxLength={500} className={fieldClass}
            placeholder="e.g. eligible accounts; all orders for a total" />
        </label>
        <p className="text-[11px] text-[var(--text-muted)] sm:col-span-2">
          Values use daily UTC dates. Confirm what this metric means before importing.
          A later change to its definition needs a new metric, so saved results stay interpretable.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--brand-blue)] px-4 py-2 text-[12px] font-semibold text-white hover:brightness-105 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Importing…" : "Confirm and import"}
        </button>
      </form>

      {state.status === "error" ? (
        <div
          role="alert"
          data-error-code={state.code}
          className={`mt-4 rounded-lg border px-4 py-3 text-left text-[12px] ${
            state.code === "conflict"
              ? "border-amber-200 bg-amber-50 text-amber-950"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          <p className="font-semibold">{state.error}</p>
          {(state.acceptedRows > 0 || state.rejectedRows > 0) ? (
            <p className="mt-1">Parsed {state.acceptedRows} valid · rejected {state.rejectedRows} · wrote 0</p>
          ) : null}
          {state.details.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-4">{state.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
          ) : null}
          {state.progress ? (
            <p className="mt-1 font-mono">Receipt {state.progress.importId.slice(0, 8)} · {state.progress.processedRows}/{state.progress.totalRows}</p>
          ) : null}
        </div>
      ) : null}
      {state.status === "success" ? (
        <div role="status" className="mt-4 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-left text-[12px] text-teal-950">
          <p className="font-semibold">
            {state.summary.created ? "Created" : "Updated"} {state.summary.metricName} and imported {state.summary.acceptedRows.toLocaleString("en-US")} rows.
          </p>
          <p className="mt-1">
            {state.summary.startDate} to {state.summary.endDate} · {state.summary.insertedRows} new · {state.summary.updatedRows} updated
          </p>
          <p className="mt-1 font-mono text-teal-900/75">Receipt {state.summary.receipt.importId.slice(0, 8)}{state.summary.receipt.resumed ? " · resumed" : ""}</p>
        </div>
      ) : null}
    </section>
  );
}
