"use client";

import { useEffect, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  generateDecisionReportAction,
  type GenerateDecisionReportActionResult,
} from "@/app/(onboarding)/onboarding/decision-report-actions";
import { recordDecisionReportTelemetryAction } from "@/app/(onboarding)/onboarding/decision-report-telemetry-actions";
import {
  DECISION_REPORT_REVIEW_EXAMPLES,
  type DecisionReportReviewExampleId,
} from "@/lib/decision-reports/fixtures/review-examples";
import type { DecisionReportPersistenceStatus } from "@/lib/decision-reports/persistence";
import type { DecisionReportActivationPointer } from "@/lib/decision-reports/persistence";
import type { ReportActivationMetric } from "@/lib/decision-reports/materialization";
import type { DecisionReportV1, MetricProjection } from "@/lib/decision-reports/schema";
import type { ReportAssetView } from "@/lib/decision-reports/assets";
import {
  REPORT_SOURCE_MAX_PDF_BYTES,
  type ReportSourceSummary,
} from "@/lib/decision-reports/sources/types";
import {
  ACTIVE_WORKSPACE_CHANGED_EVENT,
  type ActiveWorkspaceChangedDetail,
} from "@/lib/auth/workspace-events";
import { reconcileWorkspaceDraft } from "@/lib/decision-reports/workspace-draft";

const DecisionReportEditor = dynamic(
  () =>
    import("@/components/decision-report/DecisionReportEditor").then(
      (module) => module.DecisionReportEditor,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="mx-auto mt-6 w-full max-w-5xl rounded-2xl border border-[var(--border)] bg-white px-6 py-12 text-center text-[13px] text-[var(--text-muted)] shadow-sm"
        role="status"
      >
        Loading Decision Report editor…
      </div>
    ),
  },
);

type GeneratedReport = Extract<
  GenerateDecisionReportActionResult,
  { ok: true }
>["generation"];

export type InitialSavedDecisionReport = {
  workspaceId: string;
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
  workspaceId: string;
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
  activeWorkspaceName,
}: {
  initialSavedReport?: InitialSavedDecisionReport | null;
  initialLoadError?: string | null;
  activationMetrics?: ReportActivationMetric[];
  activationDateBounds: { today: string; minimum: string };
  initialTelemetrySessionKey: string;
  activeWorkspaceName: string;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [selectedExampleId, setSelectedExampleId] =
    useState<DecisionReportReviewExampleId | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
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

  useEffect(() => {
    const handleWorkspaceChange = (event: Event) => {
      const nextWorkspaceId = (
        event as CustomEvent<ActiveWorkspaceChangedDetail>
      ).detail?.workspaceId;
      if (!nextWorkspaceId) return;
      setDraft((current) => reconcileWorkspaceDraft(current, nextWorkspaceId));
      setPrompt("");
      setSelectedExampleId(null);
      setSourceUrl("");
      setPdfFile(null);
      setError(null);
    };
    window.addEventListener(ACTIVE_WORKSPACE_CHANGED_EVENT, handleWorkspaceChange);
    return () => {
      window.removeEventListener(ACTIVE_WORKSPACE_CHANGED_EVENT, handleWorkspaceChange);
    };
  }, []);

  function generateReport() {
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
      if (selectedExampleId) formData.set("reviewExampleId", selectedExampleId);
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
        workspaceId: generated.workspaceId,
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
            . Source text used for this draft. Uploaded files were not retained.
          </div>
        ) : null}
        {draft.persistence?.lineage && draft.persistence.lineage.iterationNumber > 1 ? (
          <div className="mx-auto mt-4 max-w-5xl rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-[12px] text-blue-950">
            <strong>Version {draft.persistence.lineage.iterationNumber}</strong> · {draft.persistence.lineage.iterationReason}. The current report stays active until this version is activated. Images are not copied.
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
            setSelectedExampleId(null);
            setSourceUrl("");
            setPdfFile(null);
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
          <span className="rounded-full border border-[var(--border)] bg-white px-2.5 py-1">{activeWorkspaceName}</span>
          <span aria-hidden>→</span>
          <span>New Decision Report</span>
        </div>
        <h1 className="max-w-2xl text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-[var(--text)] sm:text-[38px]">
          What&apos;s the biggest business challenge you&apos;re tackling today?
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-6 text-[var(--text-muted)] sm:text-[16px]">
          Causent helps you refine, measure, and track the decision behind it.
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg shadow-slate-200/50 sm:p-5">
        <div className="mb-4">
          <label className="text-[14px] font-semibold text-[var(--text)]" htmlFor="project-brief">
            Business challenge
          </label>
        </div>
        <textarea
          id="project-brief"
          disabled={isPending}
          className="min-h-44 w-full resize-y rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-[14px] leading-6 text-[var(--text)] outline-none placeholder:text-[var(--text-subtle)] focus:border-slate-400"
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            setSelectedExampleId(null);
            setError(null);
          }}
          placeholder="For example: Customers are dropping out of our setup flow, and we&apos;re not sure whether to simplify it or add in-product guidance."
        />
        <div className="mt-4 border-t border-[var(--border)] py-4">
          <p className="text-[12px] font-semibold text-[var(--text)]">Examples</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {DECISION_REPORT_REVIEW_EXAMPLES.map((example) => (
              <button
                key={example.id}
                type="button"
                disabled={isPending}
                onClick={() => {
                  setPrompt(example.prompt);
                  setSelectedExampleId(example.id);
                  setSourceUrl("");
                  setPdfFile(null);
                  setError(null);
                }}
                className="min-h-20 rounded-xl border border-[var(--border)] bg-slate-50/70 px-3 py-3 text-left transition-colors hover:border-[var(--brand-blue)] hover:bg-blue-50/40 disabled:opacity-50"
              >
                <span className="block text-[12px] font-semibold text-[var(--text)]">{example.label ?? example.project}</span>
                <span className="mt-1 block text-[11px] leading-5 text-[var(--text-muted)]">{example.decision}</span>
                <span className="mt-2 inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-800">{example.badge}</span>
                <span className="mt-2 block text-[11px] font-semibold text-[var(--brand-blue)]">Use example</span>
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-[var(--border)] py-4">
          <p className="text-[12px] font-semibold text-[var(--text)]">Evidence (optional)</p>
        </div>
        <div className="grid gap-3 pb-4 sm:grid-cols-2">
          <div>
            <label className="text-[11px] font-semibold text-[var(--text)]" htmlFor="source-url">
              Public URL
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
                setSelectedExampleId(null);
                setError(null);
              }}
              placeholder="https://example.com/research"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-[var(--text)]" htmlFor="source-pdf">
              Text PDF
            </label>
            <input
              id="source-pdf"
              type="file"
              accept=".pdf,application/pdf"
              disabled={isPending}
              className="mt-2 block w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-[11px] text-[var(--text-muted)] file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-[11px] file:font-semibold file:text-slate-700"
              onChange={(event) => {
                setPdfFile(event.target.files?.[0] ?? null);
                setSelectedExampleId(null);
                setError(null);
              }}
            />
            {pdfFile ? (
              <p className="mt-1.5 text-[10px] leading-4 text-[var(--text-muted)]">
                {pdfFile.name} · {(pdfFile.size / 1_048_576).toFixed(1)} MiB selected
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 border-t border-[var(--border)] pt-4">
          <button
            type="button"
            className="rounded-lg bg-[var(--text)] px-5 py-2.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={prompt.trim().length < 20 || isPending}
            onClick={generateReport}
          >
            {isPending ? "Building report…" : "Build Decision Report"}
          </button>
          <p className="max-w-xl text-right text-[10px] leading-4 text-[var(--text-muted)]">
            Causent sends your description and extracted source text to the configured AI provider.
          </p>
        </div>
        {error ? (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800" role="alert">
            {error}
          </p>
        ) : null}
      </div>

    </section>
  );
}
