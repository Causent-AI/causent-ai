"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DecisionReportEditor } from "@/components/decision-report/DecisionReportEditor";
import {
  generateDecisionReportAction,
  type GenerateDecisionReportActionResult,
} from "@/app/(onboarding)/onboarding/decision-report-actions";
import { recordDecisionReportTelemetryAction } from "@/app/(onboarding)/onboarding/decision-report-telemetry-actions";
import { GUMMY_ALPHA_GOLDEN_EXAMPLE } from "@/lib/decision-reports/fixtures/gummy-alpha";
import type { DecisionReportPersistenceStatus } from "@/lib/decision-reports/persistence";
import type { DecisionReportActivationPointer } from "@/lib/decision-reports/persistence";
import type { ReportActivationMetric } from "@/lib/decision-reports/materialization";
import type { DecisionReportV1, MetricProjection } from "@/lib/decision-reports/schema";
import type { ReportAssetView } from "@/lib/decision-reports/assets";
import {
  REPORT_SOURCE_MAX_PDF_BYTES,
  type ReportSourceSummary,
} from "@/lib/decision-reports/sources/types";

type GeneratedReport = Extract<
  GenerateDecisionReportActionResult,
  { ok: true }
>["generation"];

export type InitialSavedDecisionReport = {
  report: DecisionReportV1;
  metricProjection: MetricProjection;
  workspaceName: string;
  projectName: string;
  sourceSummaries?: ReportSourceSummary[];
  persistence: {
    reportId: string;
    revisionId: string;
    status: DecisionReportPersistenceStatus;
    savedAt: string;
    activation: DecisionReportActivationPointer | null;
    lineage: { iterationNumber: number; iterationReason: string | null } | null;
  };
  asset: ReportAssetView | null;
};

type ReportDraft = {
  report: DecisionReportV1;
  metricProjection: MetricProjection;
  workspaceName: string;
  projectName: string;
  sourceSummaries?: ReportSourceSummary[];
  /** Opaque, actor-bound capability for this generated draft's first save. */
  sourceReceiptId?: string;
  generationMeta?: {
    mode: "live" | "fixture" | "fallback";
    warning: string | null;
    latencyMs: number;
    totalTokens: number | null;
  };
  persistence?: InitialSavedDecisionReport["persistence"];
  asset?: ReportAssetView | null;
};

export function DecisionReportOnboarding({
  initialSavedReport = null,
  initialLoadError = null,
  activationMetrics = [],
  activationDateBounds,
  initialTelemetrySessionKey,
}: {
  initialSavedReport?: InitialSavedDecisionReport | null;
  initialLoadError?: string | null;
  activationMetrics?: ReportActivationMetric[];
  activationDateBounds: { today: string; minimum: string };
  initialTelemetrySessionKey: string;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [sourceEgressConfirmed, setSourceEgressConfirmed] = useState(false);
  const [draft, setDraft] = useState<ReportDraft | null>(() =>
    initialSavedReport ? { ...initialSavedReport } : null,
  );
  const [error, setError] = useState<string | null>(initialLoadError);
  const [isPending, startTransition] = useTransition();
  const [telemetryRun, setTelemetryRun] = useState({
    sessionKey: initialTelemetrySessionKey,
    startedAtMs: 0,
  });
  const [trackLanding, setTrackLanding] = useState(initialSavedReport === null);

  useEffect(() => {
    if (!trackLanding) return;
    void recordDecisionReportTelemetryAction({
      sessionKey: telemetryRun.sessionKey,
      eventType: "REPORT_LANDED",
      msSinceStart: 0,
    });
  }, [telemetryRun.sessionKey, trackLanding]);

  function generateReport() {
    if (!sourceEgressConfirmed) {
      setError("Confirm how Causent will process these sources before generating the report.");
      return;
    }
    if (pdfFile && (pdfFile.size === 0 || pdfFile.size > REPORT_SOURCE_MAX_PDF_BYTES)) {
      setError("Choose one non-empty PDF no larger than 5 MiB.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("brief", prompt);
      formData.set("telemetrySessionKey", telemetryRun.sessionKey);
      formData.set(
        "telemetryMsSinceStart",
        String(Math.max(0, Math.round(performance.now() - telemetryRun.startedAtMs))),
      );
      if (sourceUrl.trim()) formData.set("url", sourceUrl.trim());
      if (pdfFile) formData.set("pdf", pdfFile, pdfFile.name);
      let result: GenerateDecisionReportActionResult;
      try {
        result = await generateDecisionReportAction(formData);
      } catch {
        setError("Causent could not submit these sources. Your inputs are unchanged; try again.");
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const generated: GeneratedReport = result.generation;
      setDraft({
        report: generated.report,
        metricProjection: generated.metricProjection,
        workspaceName: generated.workspaceName,
        projectName: generated.projectName,
        sourceSummaries: generated.sourceSummaries,
        sourceReceiptId: generated.sourceReceiptId,
        generationMeta: {
          mode: generated.mode,
          warning: generated.warning,
          latencyMs: generated.telemetry.latencyMs,
          totalTokens: generated.telemetry.totalTokens,
        },
      });
    });
  }

  if (draft) {
    const sourceSummaries = draft.sourceSummaries ?? draft.report.sourceSummaries;
    return (
      <div id="report-top">
        {sourceSummaries && sourceSummaries.length > 1 ? (
          <div className="mx-auto mt-4 max-w-5xl rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12px] text-emerald-950">
            <strong>Sources used:</strong>{" "}
            {sourceSummaries
              .map((source) =>
                source.kind === "pdf" && source.pageCount
                  ? `${source.label} (${source.pageCount} ${source.pageCount === 1 ? "page" : "pages"})`
                  : source.label,
              )
              .join(", ")}
            . Source text was inspected for this draft; uploaded files are not retained.
          </div>
        ) : null}
        {draft.persistence?.lineage && draft.persistence.lineage.iterationNumber > 1 ? (
          <div className="mx-auto mt-4 max-w-5xl rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-[12px] text-blue-950">
            <strong>Iteration {draft.persistence.lineage.iterationNumber}</strong> · {draft.persistence.lineage.iterationReason}. The prior active report remains live until this report is activated. Its private image was not copied; attach a new sanitized image if needed.
          </div>
        ) : null}
        <DecisionReportEditor
          initialReport={draft.report}
          projection={draft.metricProjection}
          workspaceName={draft.workspaceName}
          projectName={draft.projectName}
          generationMeta={draft.generationMeta}
          initialPersistence={draft.persistence}
          initialAsset={draft.asset ?? null}
          activationMetrics={activationMetrics}
          sourceReceiptId={draft.sourceReceiptId ?? null}
          telemetrySessionKey={telemetryRun.sessionKey}
          telemetryStartedAtMs={telemetryRun.startedAtMs}
          activationDateBounds={activationDateBounds}
          onStartOver={() => {
            const nextTelemetryRun = {
              sessionKey: `dr-${crypto.randomUUID()}`,
              startedAtMs: performance.now(),
            };
            setTelemetryRun(nextTelemetryRun);
            setTrackLanding(true);
            setPrompt("");
            setSourceUrl("");
            setPdfFile(null);
            setSourceEgressConfirmed(false);
            setDraft(null);
            setError(null);
            router.replace("/onboarding", { scroll: false });
          }}
        />
      </div>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col py-6 sm:py-12">
      <div className="mb-8">
        <div className="mb-4 flex items-center gap-2 text-[11px] font-medium text-[var(--text-muted)]">
          <span className="rounded-full border border-[var(--border)] bg-white px-2.5 py-1">Orbit</span>
          <span aria-hidden>→</span>
          <span>New project</span>
        </div>
        <h1 className="max-w-2xl text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-[var(--text)] sm:text-[38px]">
          What are you building?
        </h1>
        <p className="mt-3 max-w-2xl text-[14px] leading-6 text-[var(--text-muted)]">
          Describe the decision, supporting evidence, and resources already in your plan. Causent will turn them into an editable Decision Report.
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg shadow-slate-200/50 sm:p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label className="text-[12px] font-semibold text-[var(--text)]" htmlFor="project-brief">
            Project brief
          </label>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-[11px] font-semibold text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
            disabled={isPending}
            onClick={() => {
              setPrompt(GUMMY_ALPHA_GOLDEN_EXAMPLE.initialPrompt);
              setSourceEgressConfirmed(false);
              setError(null);
            }}
          >
            Load Gummy Alpha example
          </button>
        </div>
        <textarea
          id="project-brief"
          autoFocus
          disabled={isPending}
          className="min-h-56 w-full resize-y bg-transparent text-[14px] leading-7 text-[var(--text)] outline-none placeholder:text-[var(--text-subtle)]"
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            setSourceEgressConfirmed(false);
            setError(null);
          }}
          placeholder="What are you building? What supports the decision? What resources do you already have?"
        />
        <div className="grid gap-3 border-t border-[var(--border)] py-4 sm:grid-cols-2">
          <div>
            <label className="text-[11px] font-semibold text-[var(--text)]" htmlFor="source-url">
              Source URL <span className="font-normal text-[var(--text-muted)]">(optional)</span>
            </label>
            <input
              id="source-url"
              type="url"
              inputMode="url"
              autoComplete="url"
              disabled={isPending}
              className="mt-2 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-subtle)] focus:border-slate-400"
              value={sourceUrl}
              onChange={(event) => {
                setSourceUrl(event.target.value);
                setSourceEgressConfirmed(false);
                setError(null);
              }}
              placeholder="https://example.com/research"
            />
            <p className="mt-1.5 text-[10px] leading-4 text-[var(--text-muted)]">
              One public HTTPS page. HTML or plain text only.
            </p>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-[var(--text)]" htmlFor="source-pdf">
              PDF source <span className="font-normal text-[var(--text-muted)]">(optional)</span>
            </label>
            <input
              id="source-pdf"
              type="file"
              accept=".pdf,application/pdf"
              disabled={isPending}
              className="mt-2 block w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-[11px] text-[var(--text-muted)] file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-[11px] file:font-semibold file:text-slate-700"
              onChange={(event) => {
                setPdfFile(event.target.files?.[0] ?? null);
                setSourceEgressConfirmed(false);
                setError(null);
              }}
            />
            <p className="mt-1.5 text-[10px] leading-4 text-[var(--text-muted)]">
              {pdfFile
                ? `${pdfFile.name} · ${(pdfFile.size / 1_048_576).toFixed(1)} MiB selected`
                : "One text-based PDF, up to 5 MiB and 40 pages. OCR is not included."}
            </p>
          </div>
        </div>
        <div className="border-t border-[var(--border)] py-4">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-3 text-[12px] leading-5 text-blue-950">
            <input
              type="checkbox"
              checked={sourceEgressConfirmed}
              disabled={isPending}
              onChange={(event) => {
                setSourceEgressConfirmed(event.target.checked);
                setError(null);
              }}
              className="mt-0.5 h-4 w-4 shrink-0 accent-blue-700"
            />
            <span>
              I confirm that Causent may send this project brief and extracted text from any URL or PDF to the configured AI provider to generate this report. I am authorized to share these sources.
            </span>
          </label>
          <p className="mt-2 text-[10px] leading-4 text-[var(--text-muted)]">
            Changing the brief, URL, or PDF clears this confirmation so you can review it again.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
          <p className="max-w-md text-[11px] leading-5 text-[var(--text-muted)]">
            Causent labels supplied facts, AI inferences, suggestions, and missing information separately. It will not invent owners, costs, or metric values.
          </p>
          <button
            type="button"
            className="rounded-lg bg-[var(--text)] px-5 py-2.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={prompt.trim().length < 20 || !sourceEgressConfirmed || isPending}
            onClick={generateReport}
          >
            {isPending ? "Generating report…" : "Generate Decision Report"}
          </button>
        </div>
        {error ? (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          ["01", "Decision", "The change, context, and problem"],
          ["02", "Evidence", "Signals, mechanism, and metric"],
          ["03", "Implementation", "Actions, owners, and governance"],
        ].map(([number, title, description]) => (
          <div key={number} className="rounded-xl border border-[var(--border)] bg-white/60 p-4">
            <p className="text-[10px] font-semibold text-[var(--brand-teal)]">{number}</p>
            <p className="mt-2 text-[13px] font-semibold text-[var(--text)]">{title}</p>
            <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">{description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
