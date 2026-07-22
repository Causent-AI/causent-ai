"use client";

import { useState } from "react";
import { DecisionReportEditor } from "@/components/decision-report/DecisionReportEditor";
import { GUMMY_ALPHA_GOLDEN_EXAMPLE } from "@/lib/decision-reports/fixtures/gummy-alpha";

export function DecisionReportOnboarding() {
  const [prompt, setPrompt] = useState(GUMMY_ALPHA_GOLDEN_EXAMPLE.initialPrompt);
  const [generated, setGenerated] = useState(false);

  if (generated) {
    return (
      <div id="report-top">
        <DecisionReportEditor
          initialReport={GUMMY_ALPHA_GOLDEN_EXAMPLE.report}
          projection={GUMMY_ALPHA_GOLDEN_EXAMPLE.metricProjection}
          workspaceName={GUMMY_ALPHA_GOLDEN_EXAMPLE.workspaceName}
          projectName={GUMMY_ALPHA_GOLDEN_EXAMPLE.projectName}
          onStartOver={() => setGenerated(false)}
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
        <label className="sr-only" htmlFor="project-brief">
          Project brief
        </label>
        <textarea
          id="project-brief"
          autoFocus
          className="min-h-56 w-full resize-y bg-transparent text-[14px] leading-7 text-[var(--text)] outline-none placeholder:text-[var(--text-subtle)]"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="What are you building? What supports the decision? What resources do you already have?"
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
          <p className="max-w-md text-[11px] leading-5 text-[var(--text-muted)]">
            Golden-example mode uses a deterministic report so we can evaluate the experience before connecting a model.
          </p>
          <button
            type="button"
            className="rounded-lg bg-[var(--text)] px-5 py-2.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={prompt.trim().length < 20}
            onClick={() => setGenerated(true)}
          >
            Generate Decision Report
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          ["01", "Decision", "The change, context, and problem"],
          ["02", "Evidence", "Signals, mechanism, and metric"],
          ["03", "Implementation", "Actions, owners, cost, and governance"],
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
