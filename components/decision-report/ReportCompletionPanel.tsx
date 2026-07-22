"use client";

import { useState } from "react";

import type { DecisionReportGap } from "@/lib/decision-reports/editing";
import { REQUIRED_REPORT_FIELD_COUNT } from "@/lib/decision-reports/editing";

function gapKey(gap: DecisionReportGap): string {
  return `${gap.kind}:${gap.claimId ?? "new"}`;
}

export function ReportCompletionPanel({
  gaps,
  onAnswer,
  onFocus,
}: {
  gaps: DecisionReportGap[];
  onAnswer: (gap: DecisionReportGap, answer: string) => boolean;
  onFocus: (gap: DecisionReportGap) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const visibleGaps = gaps.slice(0, 3);
  const completedCount = REQUIRED_REPORT_FIELD_COUNT - gaps.length;

  if (gaps.length === 0) {
    return (
      <section
        className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 sm:p-5"
        aria-labelledby="report-completion-title"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-[13px] font-semibold text-white"
            aria-hidden
          >
            ✓
          </span>
          <div>
            <h2
              id="report-completion-title"
              className="text-[15px] font-semibold text-emerald-950"
            >
              Required report sections complete
            </h2>
            <p className="mt-1 text-[12px] leading-5 text-emerald-900/80">
              This draft is ready for review. Owners, customers, stakeholders,
              governance, and a mock-up are optional and can be added now or later.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm shadow-slate-200/40 sm:p-5"
      aria-labelledby="report-completion-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="report-completion-title"
            className="text-[15px] font-semibold text-[var(--text)]"
          >
            Complete this report
          </h2>
          <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
            Answer up to three focused questions here, or jump to the matching field.
            No additional AI request is made.
          </p>
        </div>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-800">
          {completedCount} of {REQUIRED_REPORT_FIELD_COUNT} required fields complete
        </span>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-3">
        {visibleGaps.map((gap, index) => {
          const key = gapKey(gap);
          const answer = answers[key] ?? "";
          return (
            <div
              key={key}
              className="flex min-w-0 flex-col rounded-xl border border-[var(--border)] bg-slate-50/60 p-3"
            >
              <div className="flex items-start gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--text)] text-[9px] font-semibold text-white">
                  {index + 1}
                </span>
                <p className="text-[12px] font-semibold leading-5 text-[var(--text)]">
                  {gap.question}
                </p>
              </div>
              <textarea
                className="mt-2 min-h-16 w-full resize-y rounded-lg border border-[var(--border)] bg-white px-2.5 py-2 text-[12px] leading-5 text-[var(--text)] outline-none focus:border-[var(--brand-teal)]"
                aria-label={`Answer: ${gap.question}`}
                value={answer}
                rows={2}
                placeholder="Add your answer…"
                onChange={(event) =>
                  setAnswers((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))
                }
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-[11px] font-medium text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline"
                  aria-controls={gap.targetId}
                  onClick={() => onFocus(gap)}
                >
                  Edit in report
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-[var(--text)] px-3 py-1.5 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={answer.trim() === ""}
                  onClick={() => {
                    if (onAnswer(gap, answer)) {
                      setAnswers((current) => ({ ...current, [key]: "" }));
                    }
                  }}
                >
                  Apply answer
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {gaps.length > visibleGaps.length ? (
        <p className="mt-3 text-[11px] text-[var(--text-muted)]">
          {gaps.length - visibleGaps.length} more required {gaps.length - visibleGaps.length === 1 ? "question" : "questions"} will appear as these are completed.
        </p>
      ) : null}
    </section>
  );
}
