import { ClaimEditor } from "@/components/decision-report/ClaimEditor";
import { PredictedImpactChart } from "@/components/decision-report/PredictedImpactChart";
import { ReportSection } from "@/components/decision-report/ReportSection";
import { AutoGrowingTextarea } from "@/components/ui/AutoGrowingTextarea";
import {
  MAX_DECISION_REPORT_ACTIONS,
  type DecisionReportV1,
  type DraftAction,
  type MetricProjection,
  type PortableRichTextDocument,
} from "@/lib/decision-reports/schema";

export type ActionExecutionPatch = Partial<
  Pick<DraftAction, "priority" | "tags" | "skills" | "estimatedTime" | "estimatedCost">
>;

function commaList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function priorityLabel(priority: number): string {
  return priority === 3 ? "High priority" : priority === 2 ? "Medium priority" : "Lower priority";
}

function AudienceClaimEditor({
  claims,
  label,
  singular,
  placeholder,
  readOnly,
  onChange,
  onAdd,
}: {
  claims: DecisionReportV1["implementation"]["customers"];
  label: "Customers" | "Stakeholders";
  singular: "customer" | "stakeholder";
  placeholder: string;
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

  if (readOnly && claims.length === 0) {
    return (
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">{label}</p>
        <p className="mt-2 text-[12px] text-[var(--text-muted)]">None added.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">
        {label}
      </p>
      {visibleClaims.map((claim) => (
        <ClaimEditor
          key={claim.id}
          claim={claim}
          label={label}
          placeholder={placeholder}
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
          className="mt-2 text-[11px] font-semibold text-[var(--brand-teal)] hover:underline"
          onClick={() => onAdd("")}
        >
          Add {singular}
        </button>
      ) : null}
    </div>
  );
}

export function ImplementationSection({
  implementation,
  claimDocuments,
  projection,
  readOnly = false,
  onClaimChange,
  onClaimDocumentChange,
  onActionTitleChange,
  onActionSummaryChange,
  onActionOwnerChange,
  onActionExecutionChange,
  actionTitleDrafts,
  invalidActionTitleIds,
  selectedActionIds,
  primaryActionId,
  onActionSelectionChange,
  onPrimaryActionChange,
  onActionAdd,
  onActionRemove,
  onCustomerAdd,
  onStakeholderAdd,
}: {
  implementation: DecisionReportV1["implementation"];
  claimDocuments?: Record<string, PortableRichTextDocument>;
  projection: MetricProjection;
  readOnly?: boolean;
  onClaimChange: (claimId: string, text: string) => void;
  onClaimDocumentChange: (
    claimId: string,
    document: PortableRichTextDocument,
  ) => void;
  onActionTitleChange: (sourceItemId: string, title: string) => void;
  onActionSummaryChange: (sourceItemId: string, text: string) => void;
  onActionOwnerChange: (sourceItemId: string, text: string) => void;
  onActionExecutionChange: (sourceItemId: string, patch: ActionExecutionPatch) => void;
  actionTitleDrafts: Record<string, string>;
  invalidActionTitleIds: string[];
  selectedActionIds: string[];
  primaryActionId: string;
  onActionSelectionChange: (sourceItemId: string) => void;
  onPrimaryActionChange: (sourceItemId: string) => void;
  onActionAdd: () => void;
  onActionRemove: (sourceItemId: string) => void;
  onCustomerAdd: (text: string) => void;
  onStakeholderAdd: (text: string) => void;
}) {
  const actionConfirmationMissing = !readOnly && selectedActionIds.length === 0;
  const primaryLeverMissing =
    !readOnly &&
    selectedActionIds.length > 0 &&
    !selectedActionIds.includes(primaryActionId);
  return (
    <ReportSection
      number="4"
      title="Implementation Plan"
      description="Confirm the actions the team will carry forward."
    >
      <PredictedImpactChart
        projection={projection}
        statusLabel={readOnly ? "Activated plan context" : "Human confirmation required"}
      />

      <div
        className="rounded-xl border border-[var(--border)] bg-white p-2 shadow-sm shadow-slate-100 transition-shadow focus-within:border-blue-200 focus-within:shadow-md focus-within:shadow-blue-100/50"
        aria-label="Implementation plan document section"
      >
        <ClaimEditor
          claim={implementation.actionPlanSummary[0]}
          label="Plan summary"
          rows={3}
          variant="document"
          readOnly={readOnly}
          richTextDocument={
            claimDocuments?.[implementation.actionPlanSummary[0].id]
          }
          onDocumentChange={(document) =>
            onClaimDocumentChange(
              implementation.actionPlanSummary[0].id,
              document,
            )
          }
          onChange={(text) => onClaimChange(implementation.actionPlanSummary[0].id, text)}
        />
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-[13px] font-semibold text-[var(--text)]">Actions</h3>
          <div className="flex items-center gap-3">
            <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
              {implementation.actions.length} of {MAX_DECISION_REPORT_ACTIONS}
            </span>
            {!readOnly ? (
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-[11px] font-semibold text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
                disabled={implementation.actions.length >= MAX_DECISION_REPORT_ACTIONS}
                onClick={onActionAdd}
              >
                Add action
              </button>
            ) : null}
          </div>
        </div>
        {actionConfirmationMissing || primaryLeverMissing ? (
          <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-900" role="status">
            {actionConfirmationMissing
              ? "Confirm one to three actions for activation. The first confirmed action becomes the primary lever."
              : "Choose one confirmed action as the primary lever."}
          </p>
        ) : null}
        <ol className="flex flex-col gap-3">
          {implementation.actions.map((action, index) => {
            const priority = action.priority ?? Math.max(1, 3 - index);
            const tags = action.tags ?? [];
            const skills = action.skills ?? [];
            const selected = selectedActionIds.includes(action.sourceItemId);
            const titleDraft = actionTitleDrafts[action.sourceItemId] ?? action.title;
            const titleInvalid = invalidActionTitleIds.includes(action.sourceItemId);
            return (
              <li key={action.sourceItemId} className={`rounded-xl border bg-white p-4 ${selected ? "border-teal-300 ring-1 ring-teal-100" : "border-[var(--border)]"}`}>
                <div className="flex flex-wrap items-start gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[11px] font-semibold tabular-nums text-[var(--text)]">
                    A{index + 1}
                  </span>
                  <div className="min-w-[220px] flex-1">
                    <label className="sr-only" htmlFor={`action-title-${action.sourceItemId}`}>Action {index + 1} title</label>
                    <input
                      id={`action-title-${action.sourceItemId}`}
                      className={`w-full rounded-md border bg-transparent px-2 py-1 text-[14px] font-semibold text-[var(--text)] outline-none ${titleInvalid ? "border-amber-400 bg-amber-50/70 focus:border-amber-500" : "border-transparent focus:border-[var(--brand-blue)]"}`}
                      value={titleDraft}
                      disabled={readOnly}
                      aria-invalid={titleInvalid}
                      aria-describedby={titleInvalid ? `action-title-error-${action.sourceItemId}` : undefined}
                      onChange={(event) => onActionTitleChange(action.sourceItemId, event.target.value)}
                    />
                    {titleInvalid ? (
                      <p id={`action-title-error-${action.sourceItemId}`} className="mt-1 px-2 text-[10px] font-medium text-amber-800" role="alert">
                        Add an action title to resume autosave and activation.
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {tags.length > 0 ? tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-800">{tag}</span>
                      )) : <span className="text-[10px] text-[var(--text-subtle)]">No tags</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end text-right">
                    {!readOnly ? (
                      <label className={`flex min-h-8 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-[11px] font-semibold text-[var(--text)] ${actionConfirmationMissing ? "border-amber-300 bg-amber-50" : "border-[var(--border)]"}`}>
                        <span>Confirm</span>
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={!selected && selectedActionIds.length >= 3}
                          onChange={() => onActionSelectionChange(action.sourceItemId)}
                        />
                      </label>
                    ) : null}
                    {selected && !readOnly ? (
                      <label className={`mt-2 flex cursor-pointer items-center gap-2 text-[10px] font-semibold ${primaryLeverMissing ? "text-amber-800" : "text-teal-800"}`}>
                        <input
                          type="radio"
                          name="primary-action"
                          checked={primaryActionId === action.sourceItemId}
                          onChange={() => onPrimaryActionChange(action.sourceItemId)}
                        />
                        Primary lever
                      </label>
                    ) : null}
                    <p className="text-[10px] font-medium text-[var(--text-muted)]">{priorityLabel(priority)}</p>
                    <div className="mt-1 flex" aria-label={`Priority: ${priority} of 3`}>
                      {[1, 2, 3].map((star) => (
                        <button
                          key={star}
                          type="button"
                          disabled={readOnly}
                          aria-label={`Set priority to ${star}`}
                          onClick={() => onActionExecutionChange(action.sourceItemId, { priority: star as 1 | 2 | 3 })}
                          className={`min-h-8 min-w-8 text-[18px] ${star <= priority ? "text-amber-500" : "text-slate-300"}`}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <details className="mt-3 border-t border-[var(--border)] pt-3" open={index === 0}>
                  <summary className="cursor-pointer text-[11px] font-semibold text-[var(--brand-blue)]">Action details</summary>
                  <div className="mt-4 grid gap-4">
                    {action.summary[0] ? (
                      <ClaimEditor
                        claim={action.summary[0]}
                        label="Description"
                        placeholder="Describe the intended work and outcome…"
                        optional
                        variant="document"
                        readOnly={readOnly}
                        richTextDocument={
                          claimDocuments?.[action.summary[0].id]
                        }
                        onDocumentChange={(document) =>
                          onClaimDocumentChange(action.summary[0].id, document)
                        }
                        onChange={(text) =>
                          onActionSummaryChange(action.sourceItemId, text)
                        }
                      />
                    ) : (
                      <label className="text-[11px] font-semibold text-[var(--text-muted)]" htmlFor={`action-summary-${action.sourceItemId}`}>
                        Description
                        <AutoGrowingTextarea
                          id={`action-summary-${action.sourceItemId}`}
                          className="mt-1 block min-h-20 w-full rounded-lg border border-[var(--border)] bg-slate-50/60 px-3 py-2 text-[13px] leading-5 text-[var(--text)] outline-none focus:border-[var(--brand-blue)]"
                          value=""
                          readOnly={readOnly}
                          onChange={(event) => onActionSummaryChange(action.sourceItemId, event.target.value)}
                        />
                      </label>
                    )}
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="text-[11px] font-semibold text-[var(--text-muted)]" htmlFor={`action-owner-${action.sourceItemId}`}>
                        Owner
                        <input
                          id={`action-owner-${action.sourceItemId}`}
                          className="mt-1 block w-full rounded-lg border border-[var(--border)] px-3 py-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--brand-blue)]"
                          value={action.owner?.text ?? ""}
                          disabled={readOnly}
                          placeholder="Assign an owner"
                          onChange={(event) => onActionOwnerChange(action.sourceItemId, event.target.value)}
                        />
                      </label>
                      <label className="text-[11px] font-semibold text-[var(--text-muted)]" htmlFor={`action-time-${action.sourceItemId}`}>
                        Estimated time
                        <input
                          id={`action-time-${action.sourceItemId}`}
                          className="mt-1 block w-full rounded-lg border border-[var(--border)] px-3 py-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--brand-blue)]"
                          value={action.estimatedTime ?? ""}
                          disabled={readOnly}
                          placeholder="e.g. 2–3 weeks"
                          onChange={(event) => onActionExecutionChange(action.sourceItemId, { estimatedTime: event.target.value })}
                        />
                      </label>
                      <label className="text-[11px] font-semibold text-[var(--text-muted)]" htmlFor={`action-cost-${action.sourceItemId}`}>
                        Estimated cost
                        <input
                          id={`action-cost-${action.sourceItemId}`}
                          className="mt-1 block w-full rounded-lg border border-[var(--border)] px-3 py-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--brand-blue)]"
                          value={action.estimatedCost ?? ""}
                          disabled={readOnly}
                          placeholder="e.g. Internal team"
                          onChange={(event) => onActionExecutionChange(action.sourceItemId, { estimatedCost: event.target.value })}
                        />
                      </label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-[11px] font-semibold text-[var(--text-muted)]" htmlFor={`action-tags-${action.sourceItemId}`}>
                        Tags
                        <input
                          id={`action-tags-${action.sourceItemId}`}
                          className="mt-1 block w-full rounded-lg border border-[var(--border)] px-3 py-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--brand-blue)]"
                          defaultValue={tags.join(", ")}
                          disabled={readOnly}
                          placeholder="Product, AI"
                          onChange={(event) => onActionExecutionChange(action.sourceItemId, { tags: commaList(event.target.value) })}
                        />
                      </label>
                      <label className="text-[11px] font-semibold text-[var(--text-muted)]" htmlFor={`action-skills-${action.sourceItemId}`}>
                        Skills
                        <input
                          id={`action-skills-${action.sourceItemId}`}
                          className="mt-1 block w-full rounded-lg border border-[var(--border)] px-3 py-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--brand-blue)]"
                          defaultValue={skills.join(", ")}
                          disabled={readOnly}
                          placeholder="Product engineering, analytics"
                          onChange={(event) => onActionExecutionChange(action.sourceItemId, { skills: commaList(event.target.value) })}
                        />
                      </label>
                    </div>
                    {!readOnly ? (
                      <div className="flex justify-end border-t border-[var(--border)] pt-3">
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-red-700 underline-offset-2 hover:underline"
                          onClick={() => onActionRemove(action.sourceItemId)}
                        >
                          Remove action
                        </button>
                      </div>
                    ) : null}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
        {implementation.actions.length === 0 ? (
          <div id="report-actions-empty" className="rounded-xl border border-dashed border-amber-300 bg-amber-50/40 px-3 py-4 text-center outline-none focus:border-[var(--brand-teal)] focus:ring-2 focus:ring-teal-100" tabIndex={-1}>
            <p className="text-[12px] font-semibold text-amber-900">First action needed</p>
          </div>
        ) : null}
      </div>

      <details className="rounded-xl border border-[var(--border)] bg-slate-50/50 px-4 py-3">
        <summary className="cursor-pointer text-[12px] font-semibold text-[var(--text)]">Customers and stakeholders</summary>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <AudienceClaimEditor
            claims={implementation.customers}
            label="Customers"
            singular="customer"
            placeholder="Name the affected customer group."
            readOnly={readOnly}
            onChange={onClaimChange}
            onAdd={onCustomerAdd}
          />
          <AudienceClaimEditor
            claims={implementation.stakeholders}
            label="Stakeholders"
            singular="stakeholder"
            placeholder="Name the accountable stakeholders."
            readOnly={readOnly}
            onChange={onClaimChange}
            onAdd={onStakeholderAdd}
          />
        </div>
      </details>
    </ReportSection>
  );
}
