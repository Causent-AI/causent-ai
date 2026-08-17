"use client";

import {
  useEffect,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import type { Action, Decision, Metric, Prediction } from "@/lib/types";
import { Delta } from "@/components/ui/Delta";
import { VerdictBadge } from "@/components/actions/VerdictBadge";
import { DriftNotice } from "@/components/actions/DriftNotice";
import { MechanismChain } from "@/components/actions/MechanismChain";
import { Scorecard } from "@/components/reports/Scorecard";
import { presentVerdict } from "@/lib/verdicts";
import { validateRevision } from "@/lib/predictions";
import {
  revisePrediction,
  resolveNow,
  recordScorecardView,
} from "@/app/(dashboard)/actions/server-actions";
import { actionReferenceLabel } from "@/components/actions/ActionReference";
import { LeverCreate } from "@/components/onboarding/LeverCreate";
import { ManualCompletionForm } from "@/components/actions/ManualCompletionForm";
import { DecisionLoopHandoff } from "@/components/actions/DecisionLoopHandoff";
import { MetricHistoryExplorer } from "@/components/charts/MetricHistoryExplorer";
import { CheckIcon, ChevronIcon } from "@/components/ui/icons";
import type { Claim, DecisionReportV1, DraftAction } from "@/lib/decision-reports/schema";
import { calculateNativePredictionTarget } from "@/lib/decision-reports/prediction-calibration";
import {
  inferMetricPercentScale,
  latestMetricValueAt,
  reportExecutionState,
  signedCommitmentLabel,
} from "@/lib/decision-reports/product-continuity";
import { formatLongDate } from "@/lib/format";
import type {
  DecisionLoopCopyTarget,
  DecisionLoopHandoff as DecisionLoopHandoffContract,
} from "@/lib/decision-reports/loop-handoff";

// The decision detail view (replaces the action-centric DecisionEditor):
// intent (rationale) → the actions carrying it (lever marked) → the
// pre-registered predictions with their honest resolution readout. The trust
// caveat LEADS every readout.

/** The quiet mid-window nudge (C5/#18): when nothing has drifted and the
 *  prediction hasn't resolved, the app stays calm and just says how long is
 *  left. Absent a resolution date it renders nothing. */
function MidWindowTouch({ resolutionDate }: { resolutionDate: string }) {
  const due = Date.parse(resolutionDate);
  if (Number.isNaN(due)) return null;
  return (
    <p className="mt-1 text-[12px] text-[var(--text-subtle)]">
      <span aria-hidden="true">⧗ </span>
      Still on track — nothing has drifted. Resolves {resolutionDate}.
    </p>
  );
}

function PredictionRow({
  prediction,
  metric,
}: {
  prediction: Prediction;
  metric: Metric | undefined;
}) {
  const [revising, setRevising] = useState(false);
  const [magnitude, setMagnitude] = useState(String(prediction.magnitudePctMean));
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  // Resolution-return instrumentation (#18): one SCORECARD_VIEW per resolved
  // prediction shown. Fire-and-forget; the verdict/prediction id keys dedupe.
  useEffect(() => {
    if (!prediction.verdict) return;
    void recordScorecardView({ predictionId: prediction.id, verdict: prediction.verdict });
  }, [prediction.id, prediction.verdict]);

  const dirUp = prediction.direction === "POSITIVE";
  const good = metric ? dirUp === metric.higherIsBetter : dirUp;
  const p = prediction.verdict ? presentVerdict(prediction.verdict) : null;
  const revisable = prediction.resolvedAt === null;

  function submitRevision() {
    const newMagnitudePct = Number(magnitude);
    const errs = validateRevision({ newMagnitudePct, reason });
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    startTransition(async () => {
      const res = await revisePrediction({
        predictionId: prediction.id,
        newMagnitudePct,
        reason,
      });
      if (!res.ok) setErrors(res.errors);
      else {
        setErrors([]);
        setRevising(false);
        setReason("");
      }
    });
  }

  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      {/* The caveat leads — before any number. */}
      {p && <p className="text-[12px] leading-snug text-[var(--text-muted)]">{p.caveat}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {prediction.verdict && <VerdictBadge verdict={prediction.verdict} size="md" />}
        <span className="flex items-center gap-1.5 text-[13px] text-[var(--text)]">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: metric?.color }}
            aria-hidden="true"
          />
          {metric?.name ?? prediction.metricId}
        </span>
        <Delta
          direction={dirUp ? "up" : "down"}
          label={`we predicted ${dirUp ? "+" : "−"}${prediction.magnitudePctMean}% of mean`}
          good={good}
        />
        {prediction.measuredPct !== null && (
          <span className="text-[12px] tabular-nums text-[var(--text-muted)]">
            measured {prediction.measuredPct >= 0 ? "+" : ""}
            {prediction.measuredPct.toFixed(1)}%
          </span>
        )}
        <span className="text-[11px] text-[var(--text-subtle)]">
          {prediction.resolvedAt
            ? `resolved ${prediction.resolvedAt}`
            : `resolves ${prediction.resolutionDate}`}
        </span>
      </div>

      {/* Baseline-drift notice — the hero signal, on the prediction card (C5/#18). */}
      <DriftNotice prediction={prediction} metric={metric} />

      {/* Mid-window touch: a calm "still on track, N days to resolution" nudge
          when nothing has changed — unresolved and no baseline drift (C5/#18). */}
      {!prediction.verdict && prediction.drift?.status !== "FIRED" && (
        <MidWindowTouch resolutionDate={prediction.resolutionDate} />
      )}

      {/* Resolution scorecard: the Step-7 payoff — predicted-vs-measured once
          the engine resolves, plus the GATHERING / UNMEASURABLE surfaces (#18). */}
      {prediction.verdict && (
        <div className="mt-2">
          <Scorecard prediction={prediction} metric={metric} />
        </div>
      )}

      {prediction.revisions.length > 0 && (
        <ul className="mt-2 border-l-2 border-[var(--border)] pl-2 text-[11px] text-[var(--text-subtle)]">
          {prediction.revisions.map((r, i) => (
            <li key={i}>
              revised {r.oldMagnitudePct}% → {r.newMagnitudePct}% on {r.revisedAt}: “{r.reason}”
            </li>
          ))}
        </ul>
      )}

      {revisable && !revising && (
        <button
          type="button"
          onClick={() => setRevising(true)}
          className="mt-2 rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg)]"
        >
          Revise prediction
        </button>
      )}
      {revising && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-[var(--text-muted)]" htmlFor={`mag-${prediction.id}`}>
              New magnitude (% of mean)
            </label>
            <input
              id={`mag-${prediction.id}`}
              value={magnitude}
              onChange={(e) => setMagnitude(e.target.value)}
              inputMode="decimal"
              className="w-24 rounded border border-[var(--border)] px-2 py-1 text-[12px] tabular-nums"
            />
          </div>
          <label
            className="text-[11px] text-[var(--text-muted)]"
            htmlFor={`revision-reason-${prediction.id}`}
          >
            Reason for revision
          </label>
          <textarea
            id={`revision-reason-${prediction.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="w-full rounded border border-[var(--border)] px-2 py-1 text-[12px]"
          />
          {errors.map((e, i) => (
            <p key={i} className="text-[11px] text-[var(--neg)]">{e}</p>
          ))}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={submitRevision}
              className="rounded bg-[var(--text)] px-2.5 py-1 text-[11px] font-medium text-[var(--surface)] disabled:opacity-50"
            >
              {pending ? "Saving…" : "Log revision"}
            </button>
            <button
              type="button"
              onClick={() => setRevising(false)}
              className="rounded border border-[var(--border)] px-2.5 py-1 text-[11px]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function presentClaims(claims: Claim[]): Claim[] {
  return claims.filter((claim) => claim.status !== "missing" && claim.text.trim());
}

function reportActionFor(action: Action, report: DecisionReportV1): DraftAction | undefined {
  return report.implementation.actions.find((candidate) =>
    action.sourceItemId
      ? candidate.sourceItemId === action.sourceItemId
      : candidate.title.trim().toLowerCase() === action.title.trim().toLowerCase(),
  );
}

function DecisionSummary({ report, reportId }: { report: DecisionReportV1; reportId: string | null }) {
  const decisions = presentClaims(report.decision.decision);
  const problems = presentClaims(report.decision.problem);
  return (
    <section className="shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm shadow-slate-200/40">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-[var(--text)]">Decision</h2>
        {reportId ? (
          <Link
            href={`/onboarding?report=${encodeURIComponent(reportId)}`}
            className="text-[12px] font-semibold text-[var(--brand-blue)] hover:underline"
          >
            View Decision Report →
          </Link>
        ) : null}
      </div>
      <div className="mt-4">
        {decisions.map((claim) => (
          <p key={claim.id} className="text-[15px] font-semibold leading-6 text-[var(--text)]">{claim.text}</p>
        ))}
        {problems.map((claim) => (
          <p key={claim.id} className="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">{claim.text}</p>
        ))}
      </div>
    </section>
  );
}

function ReportCommitmentHeader({
  decision,
  prediction,
  metric,
  actions,
}: {
  decision: Decision;
  prediction: Prediction | null;
  metric: Metric | undefined;
  actions: Action[];
}) {
  const primaryAction = decision.leverActionId
    ? actions.find((action) => action.id === decision.leverActionId)
    : undefined;
  const completedActionCount = actions.filter((action) => action.shippedAt !== null).length;
  const state = reportExecutionState({
    actionCount: actions.length,
    completedActionCount,
    verdictLabel: prediction?.verdict ? presentVerdict(prediction.verdict).label : null,
  });
  const baselineNative = prediction && metric
    ? latestMetricValueAt(metric.series, prediction.committedAt)
    : null;
  const nativeTarget = prediction && metric
    ? calculateNativePredictionTarget({
        baselineNative,
        format: metric.format,
        percentScale: inferMetricPercentScale(metric.format, metric.series),
        direction: prediction.direction,
        magnitudePctMean: prediction.magnitudePctMean,
      })
    : null;

  return (
    <section
      className="shrink-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]"
      aria-labelledby="report-commitment-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--brand-teal)]">
            Outcome commitment
          </p>
          <h2 id="report-commitment-title" className="mt-0.5 text-[15px] font-semibold text-[var(--text)]">
            {metric?.name ?? prediction?.metricId ?? "Outcome metric"}
          </h2>
        </div>
        <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[10px] font-semibold text-teal-900">
          {state}
        </span>
      </div>
      <dl className="grid border-t border-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">
        <div className="px-4 py-3">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle)]">Commitment</dt>
          <dd className="mt-1 text-[12px] font-semibold text-[var(--text)]">
            {prediction
              ? signedCommitmentLabel(prediction.direction, prediction.magnitudePctMean)
              : "Not committed"}
          </dd>
          {nativeTarget?.available ? (
            <dd className="mt-0.5 text-[11px] text-[var(--text-muted)]">
              Baseline at commitment {nativeTarget.baselineLabel} · target {nativeTarget.impliedTargetLabel}
            </dd>
          ) : null}
        </div>
        <div className="border-t border-[var(--border)] px-4 py-3 sm:border-l sm:border-t-0">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle)]">Resolution</dt>
          <dd className="mt-1 text-[12px] font-semibold text-[var(--text)]">
            {prediction ? formatLongDate(prediction.resolutionDate) : "Not scheduled"}
          </dd>
        </div>
        <div className="border-t border-[var(--border)] px-4 py-3 lg:border-l lg:border-t-0">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle)]">Primary action</dt>
          <dd className="mt-1 text-[12px] font-semibold text-[var(--text)]">
            {primaryAction?.title ?? "Not assigned"}
          </dd>
        </div>
        <div className="flex min-h-11 items-center gap-2 border-t border-[var(--border)] px-2 py-2 sm:border-l lg:border-t-0">
          <Link
            href="/impact"
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg px-2 text-[11px] font-semibold text-[var(--brand-blue)] hover:bg-blue-50"
          >
            Impact
          </Link>
          <Link
            href="/data-workshop"
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg px-2 text-[11px] font-semibold text-[var(--brand-blue)] hover:bg-blue-50"
          >
            Data
          </Link>
        </div>
      </dl>
    </section>
  );
}

function ReportActionRows({
  actions,
  metrics,
  report,
  primaryLeverActionId,
  decisionLoopHandoffs,
  selectedActionId,
}: {
  actions: Action[];
  metrics: Metric[];
  report: DecisionReportV1;
  primaryLeverActionId: string | null;
  decisionLoopHandoffs: Array<{
    actionId: string;
    handoff: DecisionLoopHandoffContract;
  }>;
  selectedActionId: string | null;
}) {
  const metricById = new Map(metrics.map((metric) => [metric.id, metric]));
  const governanceSources = presentClaims(report.implementation.governance.allowedDataSources);
  const governanceNotes = presentClaims(report.implementation.governance.approvedModelNotes);
  const [expansion, setExpansion] = useState<{
    selectedActionId: string | null;
    actionIds: Set<string>;
  }>(() => ({
    selectedActionId,
    actionIds: new Set(selectedActionId ? [selectedActionId] : []),
  }));
  const [handoffSelection, setHandoffSelection] = useState<{
    actionId: string;
    target: DecisionLoopCopyTarget;
  } | null>(null);

  if (selectedActionId !== expansion.selectedActionId) {
    const actionIds = new Set(expansion.actionIds);
    if (selectedActionId) actionIds.add(selectedActionId);
    setExpansion({
      selectedActionId,
      actionIds,
    });
  }

  function toggleAction(actionId: string) {
    setExpansion((current) => {
      const next = new Set(current.actionIds);
      if (next.has(actionId)) next.delete(actionId);
      else next.add(actionId);
      return { ...current, actionIds: next };
    });
  }

  const selectedHandoff = handoffSelection
    ? decisionLoopHandoffs.find((candidate) => candidate.actionId === handoffSelection.actionId)
    : null;

  return (
    <section className="shrink-0">
      <h2 className="text-[15px] font-semibold text-[var(--text)]">Actions</h2>
      <div className="mt-3 space-y-2">
        {actions.map((action) => {
          const detail = reportActionFor(action, report);
          const summaries = detail ? presentClaims(detail.summary) : [];
          const reference = actionReferenceLabel(action);
          const priority = detail?.priority ?? Math.max(1, 3 - actions.indexOf(action));
          const tags = detail?.tags ?? [];
          const loopHandoff = decisionLoopHandoffs.find(
            (candidate) => candidate.actionId === action.id,
          )?.handoff;
          const driftWatchArmed = action.id === primaryLeverActionId;
          const assignedMetric = action.primaryMetricId
            ? metricById.get(action.primaryMetricId)
            : undefined;
          const expanded = expansion.actionIds.has(action.id);
          const contentId = `action-details-${action.id}`;
          return (
            <article
              key={action.id}
              id={action.id}
              className="scroll-mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]"
            >
              <div className="grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-stretch">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={contentId}
                  onClick={() => toggleAction(action.id)}
                  className="grid min-h-16 w-full grid-cols-[22px_minmax(0,1fr)] items-center gap-3 px-4 py-3 text-left hover:bg-black/[0.015] focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--brand-blue)]"
                >
                  <ChevronIcon className={`text-[var(--text-subtle)] transition-transform ${expanded ? "rotate-180" : ""}`} />
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 rounded-md border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-teal-800">
                        {action.displayCode ?? "Action"}
                      </span>
                      {driftWatchArmed ? (
                        <span
                          className="inline-flex shrink-0 items-center gap-1 text-[9px] font-semibold text-amber-800"
                          aria-label="Drift watch active"
                          title="Drift watch active"
                        >
                          <span className="h-2 w-2 rounded-full border border-amber-500 bg-amber-300" aria-hidden="true" />
                          Drift watch
                        </span>
                      ) : null}
                      <span className="truncate text-[13px] font-semibold text-[var(--text)]">{action.title}</span>
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] tracking-[0.08em] text-amber-500" aria-label={`${priority} of 3 priority`}>
                        {"★".repeat(priority)}<span className="text-slate-300">{"★".repeat(3 - priority)}</span>
                      </span>
                      {tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-semibold text-blue-800">{tag}</span>
                      ))}
                      <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[9px] font-semibold text-teal-800">
                        {assignedMetric?.name ?? "Metric not assigned"}
                      </span>
                    </span>
                  </span>
                </button>
                <div className="flex min-h-16 flex-wrap items-center gap-2 border-t border-[var(--border)] px-4 py-2 sm:justify-end sm:border-l sm:border-t-0 sm:px-3">
                  {loopHandoff ? (
                    <>
                      <span className="text-[10px] font-medium text-[var(--text-subtle)]">
                        Copy Task Instructions to:
                      </span>
                      {(["claude", "codex"] as const).map((target) => (
                        <button
                          key={target}
                          type="button"
                          aria-label={`Copy ${action.displayCode ?? action.title} task instructions to ${target === "claude" ? "Claude" : "Codex"}`}
                          onClick={() => setHandoffSelection({ actionId: action.id, target })}
                          className="min-h-11 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-[10px] font-semibold text-indigo-800 hover:bg-indigo-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                        >
                          {target === "claude" ? "Claude" : "Codex"}
                        </button>
                      ))}
                    </>
                  ) : null}
                  <span className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-[10px] font-semibold ${
                    action.shippedAt
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-[var(--border)] bg-white text-[var(--text-muted)]"
                  }`}>
                    <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border ${action.shippedAt ? "border-emerald-600 bg-emerald-600 text-white" : "border-[var(--border-strong)]"}`}>
                      {action.shippedAt ? <CheckIcon size={10} strokeWidth={2.5} /> : null}
                    </span>
                    {action.shippedAt ? "Complete" : "Open"}
                  </span>
                </div>
              </div>
              <div
                id={contentId}
                hidden={!expanded}
                className="border-t border-[var(--border)] px-4 py-4 sm:pl-[58px]"
              >
                {summaries.length > 0 ? (
                  <div>
                    <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">Details</h3>
                    {summaries.map((claim) => <p key={claim.id} className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">{claim.text}</p>)}
                  </div>
                ) : action.rationale?.body.length ? (
                  <div>
                    <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">Details</h3>
                    {action.rationale.body.map((paragraph, index) => <p key={index} className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">{paragraph}</p>)}
                  </div>
                ) : null}
                <dl className="mt-3 grid gap-3 text-[11px] sm:grid-cols-3 lg:grid-cols-6">
                  <div><dt className="font-semibold text-[var(--text-subtle)]">Owner</dt><dd className="mt-1 text-[var(--text)]">{detail?.owner?.text || action.ownerLabel || "Not assigned"}</dd></div>
                  <div>
                    <dt className="font-semibold text-[var(--text-subtle)]">Assigned metric</dt>
                    <dd className="mt-1 text-[var(--text)]">
                      {assignedMetric?.name ?? "Not assigned"}
                      {assignedMetric ? (
                        <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                          {driftWatchArmed ? "Primary action" : "Supporting action"}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  <div><dt className="font-semibold text-[var(--text-subtle)]">Work item</dt><dd className="mt-1 text-[var(--text)]">{reference}</dd></div>
                  <div><dt className="font-semibold text-[var(--text-subtle)]">Completed</dt><dd className="mt-1 text-[var(--text)]">{action.shippedAt ?? "Not yet"}</dd></div>
                  <div><dt className="font-semibold text-[var(--text-subtle)]">Time</dt><dd className="mt-1 text-[var(--text)]">{detail?.estimatedTime || "Not estimated"}</dd></div>
                  <div><dt className="font-semibold text-[var(--text-subtle)]">Cost</dt><dd className="mt-1 text-[var(--text)]">{detail?.estimatedCost || "Not estimated"}</dd></div>
                </dl>
                {detail?.skills?.length ? (
                  <p className="mt-3 text-[11px] text-[var(--text-muted)]"><span className="font-semibold text-[var(--text)]">Skills: </span>{detail.skills.join(", ")}</p>
                ) : null}
                <div className="mt-3 rounded-lg bg-[var(--bg)] px-3 py-2 text-[10px] leading-4 text-[var(--text-muted)]">
                  <span className="font-semibold text-[var(--text)]">Governance: </span>
                  {report.implementation.governance.dataClassification
                    ? `${report.implementation.governance.dataClassification} data. `
                    : "Data classification not set. "}
                  {[...governanceSources, ...governanceNotes].map((claim) => claim.text).join(" ")}
                </div>
                {action.manualCompletion ? (
                  <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-900">
                    Completed {action.manualCompletion.completedOn}: {action.manualCompletion.explanation}
                  </p>
                ) : action.source === "manual" ? (
                  <div className="mt-3"><ManualCompletionForm actionId={action.id} /></div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
      {handoffSelection && selectedHandoff ? (
        <DecisionLoopHandoff
          handoff={selectedHandoff.handoff}
          target={handoffSelection.target}
          onClose={() => setHandoffSelection(null)}
        />
      ) : null}
    </section>
  );
}

export function DecisionDetail({
  decision,
  actions,
  metrics,
  onSelectAction,
  connectorMetricId,
  report = null,
  reportId = null,
  decisionLoopHandoffs = [],
  selectedActionId = null,
}: {
  decision: Decision;
  actions: Action[];
  metrics: Metric[];
  onSelectAction: (id: string) => void;
  connectorMetricId: string | null;
  report?: DecisionReportV1 | null;
  reportId?: string | null;
  decisionLoopHandoffs?: Array<{
    actionId: string;
    handoff: DecisionLoopHandoffContract;
  }>;
  selectedActionId?: string | null;
}) {
  const metricById = new Map(metrics.map((m) => [m.id, m]));
  const actionById = new Map(actions.map((a) => [a.id, a]));
  const reportActions = decision.actionIds.flatMap((id) => actionById.get(id) ?? []);
  const reportMetric = connectorMetricId
    ? metricById.get(connectorMetricId)
    : decision.predictions[0]
      ? metricById.get(decision.predictions[0].metricId)
      : undefined;
  const reportPrediction = reportMetric
    ? decision.predictions.find((prediction) => prediction.metricId === reportMetric.id) ??
      decision.predictions[0] ??
      null
    : decision.predictions[0] ?? null;
  const [resolvePending, startResolve] = useTransition();
  const [resolveMsg, setResolveMsg] = useState<string | null>(null);
  const hasUnresolved = decision.predictions.some((p) => p.resolvedAt === null);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      {report ? <DecisionSummary report={report} reportId={reportId} /> : <div>
        <h2 className="text-[22px] font-semibold tracking-tight text-[var(--text)]">
          {decision.title}
        </h2>
        <p className="mt-0.5 text-[12px] text-[var(--text-subtle)]">
          decided {decision.createdAt}
          {decision.rationale.mechanismCategory && (
            <> · {decision.rationale.mechanismCategory}</>
          )}
        </p>
      </div>}

      {report ? (
        <ReportCommitmentHeader
          decision={decision}
          prediction={reportPrediction}
          metric={reportMetric}
          actions={reportActions}
        />
      ) : null}

      {report && reportMetric ? (
        <div className="shrink-0">
          <MetricHistoryExplorer
            metric={reportMetric}
            actions={reportActions}
            primaryActionId={decision.leverActionId}
          />
        </div>
      ) : null}

      {!report && decision.rationale.body.length > 0 && (
        <div className="flex flex-col gap-2">
          {decision.rationale.body.map((para, i) => (
            <p key={i} className="text-[13px] leading-relaxed text-[var(--text-muted)]">
              {para}
            </p>
          ))}
        </div>
      )}

      {report ? (
        <ReportActionRows
          actions={reportActions}
          metrics={metrics}
          report={report}
          primaryLeverActionId={decision.leverActionId}
          decisionLoopHandoffs={decisionLoopHandoffs}
          selectedActionId={selectedActionId}
        />
      ) : <section>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
          Actions
        </h3>
        <ul className="mt-2 flex flex-col gap-1">
          {decision.actionIds.map((id) => {
            const a = actionById.get(id);
            const isLever = id === decision.leverActionId;
            return (
              <li key={id} className="flex items-center gap-2 text-[13px]">
                <button
                  type="button"
                  onClick={() => onSelectAction(id)}
                  className="text-[var(--text)] underline-offset-2 hover:underline"
                >
                  {a ? `${actionReferenceLabel(a)} ${a.title}` : id}
                </button>
                {isLever && (
                  <span className="rounded-full border border-[var(--text)]/20 bg-[var(--bg)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                    primary
                  </span>
                )}
                {a && a.shippedAt === null && (
                  <span className="text-[11px] text-[var(--text-subtle)]">
                    {a.source === "manual" ? "planned" : "not shipped"}
                  </span>
                )}
              </li>
            );
          })}
          {decision.actionIds.length === 0 && (
            <li className="text-[12px] text-[var(--text-subtle)]">
              No actions mapped yet.
            </li>
          )}
        </ul>
      </section>}

      {!report ? <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
            Prediction
          </h3>
          {hasUnresolved && process.env.NODE_ENV !== "production" && (
            <button
              type="button"
              disabled={resolvePending}
              onClick={() =>
                startResolve(async () => {
                  const res = await resolveNow();
                  setResolveMsg(res.ok ? "Resolution sweep ran." : res.errors[0]);
                })
              }
              className="rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg)]"
            >
              {resolvePending ? "Resolving…" : "Resolve now (dev)"}
            </button>
          )}
        </div>
        {resolveMsg && <p className="text-[11px] text-[var(--text-subtle)]">{resolveMsg}</p>}
        <MechanismChain decision={decision} actions={actions} metrics={metrics} />
        {decision.predictions.map((p) => (
          <PredictionRow key={p.id} prediction={p} metric={metricById.get(p.metricId)} />
        ))}
        {decision.predictions.length === 0 && (
          <p className="text-[12px] text-[var(--text-subtle)]">No prediction committed.</p>
        )}
      </section> : null}

      {!report && decision.origin === "decision_report" && !decision.leverActionId && connectorMetricId ? (
        <LeverCreate
          decisionId={decision.id}
          metricId={connectorMetricId}
          title={decision.title}
          mechanismSummary={decision.rationale.body.join("\n\n") || decision.title}
          mechanismCategory={decision.rationale.mechanismCategory}
        />
      ) : null}
    </div>
  );
}
