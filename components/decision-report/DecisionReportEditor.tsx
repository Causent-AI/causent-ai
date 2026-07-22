"use client";

import { useState } from "react";
import { ProvenanceLegend } from "@/components/decision-report/ClaimEditor";
import { DecisionSection } from "@/components/decision-report/DecisionSection";
import { ImplementationSection } from "@/components/decision-report/ImplementationSection";
import { ReportCompletionPanel } from "@/components/decision-report/ReportCompletionPanel";
import { SupportingEvidenceSection } from "@/components/decision-report/SupportingEvidenceSection";
import {
  applyReportEditCommand,
  createGapAnswerCommand,
  scanDecisionReportGaps,
  type DecisionReportGap,
  type ReportEditCommandV1,
} from "@/lib/decision-reports/editing";
import type { DecisionReportV1, MetricProjection } from "@/lib/decision-reports/schema";
import { cloneDecisionReport } from "@/lib/decision-reports/schema";

export function DecisionReportEditor({
  initialReport,
  projection,
  workspaceName,
  projectName,
  generationMeta,
  onStartOver,
}: {
  initialReport: DecisionReportV1;
  projection: MetricProjection;
  workspaceName: string;
  projectName: string;
  generationMeta?: {
    mode: "live" | "fixture" | "fallback";
    warning: string | null;
    latencyMs: number;
    totalTokens: number | null;
  };
  onStartOver: () => void;
}) {
  const [report, setReport] = useState(() => cloneDecisionReport(initialReport));
  const [editError, setEditError] = useState<string | null>(null);
  const gaps = scanDecisionReportGaps(report);
  const ready = gaps.length === 0;

  function dispatchEdit(command: ReportEditCommandV1): boolean {
    const result = applyReportEditCommand(report, command);
    if (!result.ok) {
      setEditError(result.error);
      return false;
    }
    setEditError(null);
    setReport(result.report);
    return true;
  }

  function updateClaim(claimId: string, text: string) {
    dispatchEdit({ type: "replace_claim_text", claimId, text });
  }

  function updateActionTitle(sourceItemId: string, title: string) {
    dispatchEdit({ type: "edit_action_title", sourceItemId, title });
  }

  function updateActionSummary(sourceItemId: string, text: string) {
    dispatchEdit({ type: "edit_action_summary", sourceItemId, text });
  }

  function updateActionOwner(sourceItemId: string, text: string) {
    dispatchEdit({ type: "edit_action_owner", sourceItemId, text });
  }

  function focusGap(gap: DecisionReportGap) {
    const target = document.getElementById(gap.targetId);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
  }

  function answerGap(gap: DecisionReportGap, answer: string): boolean {
    const command = createGapAnswerCommand(
      gap,
      answer,
      gap.kind === "action" ? `user-action-${crypto.randomUUID()}` : undefined,
    );
    if (!command.ok) {
      setEditError(command.error);
      return false;
    }
    return dispatchEdit(command.command);
  }

  function setDataClassification(
    value: DecisionReportV1["implementation"]["governance"]["dataClassification"],
  ) {
    dispatchEdit({
      type: "set_data_classification",
      value,
    });
  }

  return (
    <div className="flex flex-col gap-3 pb-16">
      {generationMeta?.warning ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-5 text-amber-900" role="status">
          {generationMeta.warning}
        </div>
      ) : null}
      <header className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm shadow-slate-200/40 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-[var(--text-muted)]">
              <span>{workspaceName}</span>
              <span aria-hidden>·</span>
              <span>{projectName}</span>
              <span className="rounded-full bg-teal-50 px-2 py-0.5 font-semibold text-[var(--pos)]">
                Draft
              </span>
              <span
                className={`rounded-full px-2 py-0.5 font-semibold ${
                  ready
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-amber-50 text-amber-800"
                }`}
              >
                {ready ? "Ready for review" : `${gaps.length} required fields open`}
              </span>
              {generationMeta ? (
                <span>
                  {generationMeta.mode === "live" ? "AI generated" : generationMeta.mode === "fixture" ? "Fixture mode" : "Safe fallback"}
                  {generationMeta.mode === "live"
                    ? ` · ${(generationMeta.latencyMs / 1000).toFixed(1)}s${generationMeta.totalTokens ? ` · ${generationMeta.totalTokens.toLocaleString()} tokens` : ""}`
                    : ""}
                </span>
              ) : null}
            </div>
            <input
              className="mt-2 w-full bg-transparent text-[24px] font-semibold leading-tight text-[var(--text)] outline-none sm:text-[28px]"
              aria-label="Report title"
              value={report.title}
              onChange={(event) => setReport((current) => ({ ...current, title: event.target.value }))}
            />
            <p className="mt-1 max-w-2xl text-[12px] leading-5 text-[var(--text-muted)]">
              One brief produced a decision, evidence map, metric hypothesis, and action plan. Every field remains yours to edit.
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-[12px] font-medium text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
            onClick={onStartOver}
          >
            Edit
          </button>
        </div>
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">
            How to read this draft
          </p>
          <ProvenanceLegend />
        </div>
      </header>

      <DecisionSection decision={report.decision} onClaimChange={updateClaim} />
      <SupportingEvidenceSection
        evidence={report.supportingEvidence}
        projection={projection}
        onClaimChange={updateClaim}
      />
      <ImplementationSection
        implementation={report.implementation}
        onClaimChange={updateClaim}
        onActionTitleChange={updateActionTitle}
        onActionSummaryChange={updateActionSummary}
        onActionOwnerChange={updateActionOwner}
        onDataClassificationChange={setDataClassification}
      />

      <ReportCompletionPanel
        gaps={gaps}
        onAnswer={answerGap}
        onFocus={focusGap}
      />

      {editError ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800"
          role="alert"
        >
          {editError}
        </p>
      ) : null}

      <div
        className={`sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 shadow-lg shadow-slate-300/30 backdrop-blur ${
          ready
            ? "border-emerald-200 bg-emerald-50/95"
            : "border-[var(--border)] bg-white/95"
        }`}
        aria-live="polite"
      >
        <div>
          <p className={`text-[12px] font-semibold ${ready ? "text-emerald-900" : "text-[var(--text)]"}`}>
            {ready ? "Ready for review" : "Decision Report not ready"}
          </p>
          <p className={`text-[11px] ${ready ? "text-emerald-900/75" : "text-[var(--text-muted)]"}`}>
            {ready
              ? "All six required report fields are complete. Optional details are marked separately."
              : `${gaps.length} required ${gaps.length === 1 ? "field remains" : "fields remain"}. Changes live only in this browser session.`}
          </p>
        </div>
        {!ready ? (
          <button
            type="button"
            className="rounded-lg bg-[var(--text)] px-4 py-2 text-[12px] font-semibold text-white"
            aria-controls={gaps[0].targetId}
            onClick={() => focusGap(gaps[0])}
          >
            Go to next required field
          </button>
        ) : null}
      </div>
    </div>
  );
}
