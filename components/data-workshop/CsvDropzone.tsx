"use client";

import { useActionState, useRef, useState } from "react";
import { FileCsvIcon } from "@/components/ui/icons";
import {
  importActiveReportMetricCsvAction,
  type MetricCsvImportActionState,
} from "@/app/(dashboard)/data-workshop/server-actions";

const INITIAL_STATE: MetricCsvImportActionState = { status: "idle" };

export function CsvDropzone({ enabled, metricName }: { enabled: boolean; metricName?: string }) {
  const [state, action, pending] = useActionState(importActiveReportMetricCsvAction, INITIAL_STATE);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function submitFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file || !formRef.current || !inputRef.current) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    inputRef.current.files = transfer.files;
    formRef.current.requestSubmit();
  }

  return (
    <form
      ref={formRef}
      action={action}
      onDragEnter={(event) => { event.preventDefault(); if (enabled) setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (enabled) submitFiles(event.dataTransfer.files);
      }}
      className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center ${
        dragging ? "border-[var(--brand-blue)] bg-blue-50/50" : "border-[var(--border-strong)]"
      }`}
    >
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)]">
        <FileCsvIcon />
      </div>
      <div className="text-[16px] font-semibold text-[var(--text)]">
        {enabled ? `Import ${metricName ?? "report metric"}` : "Metric CSV import"}
      </div>
      <div className="mt-1 text-[13px] text-[var(--text-muted)]">
        {enabled ? (
          <>Drop one CSV here or browse · exact <span className="font-mono">date,value</span> header · daily · 256 KB max</>
        ) : (
          "Activate a Decision Report to choose the only metric this importer may update."
        )}
      </div>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        name="csv"
        accept=".csv,text/csv"
        disabled={!enabled || pending}
        onChange={(event) => {
          if (event.currentTarget.files?.[0]) event.currentTarget.form?.requestSubmit();
        }}
      />
      <button
        type="button"
        disabled={!enabled || pending}
        onClick={() => inputRef.current?.click()}
        className="mt-4 rounded-lg bg-[var(--brand-blue)] px-4 py-2 text-[13px] font-semibold text-white hover:brightness-105"
      >
        {pending ? "Validating and importing…" : "Choose CSV"}
      </button>
      {state.status === "error" ? (
        <div role="alert" className="mt-4 w-full max-w-2xl rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-left text-[12px] text-red-900">
          <p className="font-semibold">{state.error}</p>
          {(state.acceptedRows > 0 || state.rejectedRows > 0) ? (
            <p className="mt-1">Parsed {state.acceptedRows} valid · rejected {state.rejectedRows} · wrote 0</p>
          ) : null}
          {state.details.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-4">{state.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
          ) : null}
        </div>
      ) : null}
      {state.status === "success" ? (
        <div role="status" className="mt-4 w-full max-w-2xl rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-left text-[12px] text-teal-950">
          <p className="font-semibold">Imported {state.summary.acceptedRows.toLocaleString("en-US")} rows into {state.summary.metricName}.</p>
          <p className="mt-1">
            {state.summary.startDate} to {state.summary.endDate} · {state.summary.insertedRows} new · {state.summary.updatedRows} updated · {state.summary.rejectedRows} rejected
          </p>
          <p className="mt-1 text-teal-900/75">
            {state.summary.existingObservationsUpdated
              ? "Existing observations on matching dates were updated; all other dates were preserved."
              : "No existing observations were changed."}
          </p>
        </div>
      ) : null}
    </form>
  );
}
