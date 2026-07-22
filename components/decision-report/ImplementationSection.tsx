import { ClaimEditor, ClaimListEditor } from "@/components/decision-report/ClaimEditor";
import { ReportSection } from "@/components/decision-report/ReportSection";
import type { DecisionReportV1 } from "@/lib/decision-reports/schema";

type GovernanceValue = DecisionReportV1["implementation"]["governance"]["dataClassification"];

export function ImplementationSection({
  implementation,
  onClaimChange,
  onActionTitleChange,
  onActionSummaryChange,
  onActionOwnerChange,
  onDataClassificationChange,
}: {
  implementation: DecisionReportV1["implementation"];
  onClaimChange: (claimId: string, text: string) => void;
  onActionTitleChange: (sourceItemId: string, title: string) => void;
  onActionSummaryChange: (sourceItemId: string, text: string) => void;
  onActionOwnerChange: (sourceItemId: string, text: string) => void;
  onDataClassificationChange: (value: GovernanceValue) => void;
}) {
  return (
    <ReportSection
      number="3"
      title="Implementation"
      description="A three-step action plan plus optional ownership, audience, assets, and governance details."
    >
      <ClaimEditor
        claim={implementation.actionPlanSummary[0]}
        label="Action Plan summary"
        onChange={(text) => onClaimChange(implementation.actionPlanSummary[0].id, text)}
      />

      <div>
        <div className="mb-3 flex items-center justify-between gap-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">
            Draft actions
          </p>
          <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
            {implementation.actions.length} of 3
          </span>
        </div>
        <ol className="flex flex-col gap-2">
          {implementation.actions.map((action, index) => (
            <li
              key={action.sourceItemId}
              className="grid gap-2 rounded-xl border border-[var(--border)] p-3 md:grid-cols-[24px_1fr_0.55fr]"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--brand-teal)] text-[10px] font-semibold tabular-nums text-[var(--brand-teal)]">
                {index + 1}
              </span>
              <div className="min-w-0">
                <label className="sr-only" htmlFor={`action-title-${action.sourceItemId}`}>
                  Action {index + 1} title
                </label>
                <input
                  id={`action-title-${action.sourceItemId}`}
                  className="w-full bg-transparent text-[13px] font-semibold text-[var(--text)] outline-none"
                  value={action.title}
                  onChange={(event) => onActionTitleChange(action.sourceItemId, event.target.value)}
                />
                <label className="sr-only" htmlFor={`action-summary-${action.sourceItemId}`}>
                  Action {index + 1} details
                </label>
                <textarea
                  id={`action-summary-${action.sourceItemId}`}
                  className="mt-0.5 w-full resize-y bg-transparent text-[12px] leading-5 text-[var(--text-muted)] outline-none"
                  rows={1}
                  value={action.summary[0]?.text ?? ""}
                  onChange={(event) => onActionSummaryChange(action.sourceItemId, event.target.value)}
                />
              </div>
              <div
                className={`rounded-lg border px-2.5 py-1.5 ${
                  action.owner
                    ? "border-teal-200 bg-teal-50/40"
                    : "border-dashed border-slate-300 bg-slate-50/60"
                }`}
              >
                <label
                  className={`text-[10px] font-semibold uppercase tracking-wide ${
                    action.owner ? "text-teal-800" : "text-slate-600"
                  }`}
                  htmlFor={`action-owner-${action.sourceItemId}`}
                >
                  {action.owner ? "Owner · confirmed by you" : "Owner · optional"}
                </label>
                <input
                  id={`action-owner-${action.sourceItemId}`}
                  className="mt-1 w-full bg-transparent text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text-subtle)]"
                  value={action.owner?.text ?? ""}
                  placeholder="Assign an owner"
                  onChange={(event) => onActionOwnerChange(action.sourceItemId, event.target.value)}
                />
              </div>
            </li>
          ))}
        </ol>
        {implementation.actions.length === 0 ? (
          <div
            id="report-actions-empty"
            className="rounded-xl border border-dashed border-amber-300 bg-amber-50/40 px-3 py-4 text-center outline-none focus:border-[var(--brand-teal)] focus:ring-2 focus:ring-teal-100"
            tabIndex={-1}
          >
            <p className="text-[12px] font-semibold text-amber-900">First action needed</p>
            <p className="mt-1 text-[11px] leading-5 text-amber-900/75">
              Use the focused question below to add the first concrete implementation step.
            </p>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ClaimListEditor
          claims={implementation.customers}
          label="Customers"
          placeholder="Name the affected customer group."
          optional
          onChange={onClaimChange}
        />
        <ClaimListEditor
          claims={implementation.stakeholders}
          label="Stakeholders"
          placeholder="Name the accountable stakeholders."
          optional
          onChange={onClaimChange}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
            Supplied mock-up · optional
          </p>
          <div className="mt-3 flex min-h-28 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white/70 px-4 text-center">
            <p className="max-w-xs text-[12px] leading-5 text-[var(--text-muted)]">
              No mock-up supplied. This remains visible so the report never implies that one was generated or reviewed.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">
            Governance declarations · optional
          </p>
          <label className="mt-3 block text-[11px] font-medium text-[var(--text-muted)]" htmlFor="data-classification">
            Data visibility · optional
          </label>
          <select
            id="data-classification"
            className="mt-1 w-full rounded border border-[var(--border)] bg-white px-3 py-2 text-[12px] text-[var(--text)]"
            value={implementation.governance.dataClassification ?? ""}
            onChange={(event) => onDataClassificationChange((event.target.value || null) as GovernanceValue)}
          >
            <option value="">Not declared</option>
            <option value="private">Private</option>
            <option value="organization">Organization</option>
            <option value="public">Public</option>
          </select>
          <div className="mt-3 flex flex-col gap-2">
            <ClaimEditor
              claim={implementation.governance.allowedDataSources[0]}
              label="Allowed data sources"
              rows={2}
              optional
              onChange={(text) =>
                onClaimChange(implementation.governance.allowedDataSources[0].id, text)
              }
            />
            <ClaimEditor
              claim={implementation.governance.approvedModelNotes[0]}
              label="Approved model notes"
              rows={2}
              optional
              onChange={(text) =>
                onClaimChange(implementation.governance.approvedModelNotes[0].id, text)
              }
            />
          </div>
        </div>
      </div>
    </ReportSection>
  );
}
