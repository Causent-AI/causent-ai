"use client";

import { useState } from "react";

import { PredictionOutcomeChart } from "@/components/charts/PredictionOutcomeChart";
import {
  PredictedImpactChart,
  type LivePredictionCommitment,
} from "@/components/decision-report/PredictedImpactChart";
import { Panel } from "@/components/ui/Panel";
import { buildPredictionOutcomeViewModel, type PredictionOutcomeViewModel } from "@/lib/scorecard-chart";
import type { Decision, Metric } from "@/lib/types";
import type { MetricProjection } from "@/lib/decision-reports/schema";
import {
  inferMetricPercentScale,
  latestMetricObservationAt,
} from "@/lib/decision-reports/product-continuity";

type PredictionView = "plan" | "outcome";

function PredictionPanelView({
  defaultView,
  outcome,
  projection,
  liveCommitment,
}: {
  defaultView: PredictionView;
  outcome: PredictionOutcomeViewModel;
  projection: MetricProjection;
  liveCommitment?: LivePredictionCommitment;
}) {
  const [view, setView] = useState<PredictionView>(defaultView);

  return (
    <>
      <div
        role="group"
        aria-label="Prediction chart view"
        className="mb-4 inline-flex rounded-lg border border-[var(--border)] bg-slate-50 p-1"
      >
        {(["plan", "outcome"] as const).map((candidate) => {
          const selected = view === candidate;
          return (
            <button
              key={candidate}
              type="button"
              aria-pressed={selected}
              onClick={() => setView(candidate)}
              className={`min-h-11 rounded-md px-3 py-1.5 text-[12px] font-semibold capitalize transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-blue)] ${
                selected
                  ? "bg-white text-[var(--text)] shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {candidate}
            </button>
          );
        })}
      </div>

      {view === "plan" ? (
        <>
          <PredictedImpactChart
            projection={projection}
            statusLabel="Activated commitment"
            liveCommitment={liveCommitment}
          />
          <p className="mt-3 text-[11px] leading-5 text-[var(--text-muted)]">
            Activation-time commitment, not a measured outcome.
          </p>
        </>
      ) : (
        <PredictionOutcomeChart viewModel={outcome} />
      )}
    </>
  );
}

export function PredictionPanel({
  decision,
  predictionId,
  projection,
  metric,
}: {
  decision: Decision | null;
  predictionId: string | null;
  projection: MetricProjection;
  metric: Metric | null;
}) {
  const prediction = decision?.predictions.find((candidate) => candidate.id === predictionId) ?? null;
  const baselineObservation = prediction && metric
    ? latestMetricObservationAt(metric.series, prediction.committedAt)
    : null;
  const liveCommitment: LivePredictionCommitment | undefined = prediction && metric
    ? {
        metricSelected: true,
        metricName: metric.name,
        baselineNative: baselineObservation?.value ?? null,
        baselineDate: baselineObservation?.date ?? null,
        baselineUnavailableLabel: "Commitment baseline unavailable",
        format: metric.format,
        percentScale: inferMetricPercentScale(metric.format, metric.series),
        direction: prediction.direction,
        magnitudePctMean: prediction.magnitudePctMean,
      }
    : undefined;
  const outcome = buildPredictionOutcomeViewModel({
    prediction,
    metricName: metric?.name ?? projection.metricName,
    observationCount: metric?.series.length ?? 0,
  });
  const defaultView: PredictionView = outcome.hasMeasurement ? "outcome" : "plan";

  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-[var(--text)]">Prediction</h2>
        {prediction ? (
          <div className="text-right text-[11px] text-[var(--text-muted)]">
            <p className="font-semibold text-[var(--text)]">
              {prediction.direction === "POSITIVE" ? "Increase" : "Decrease"} {prediction.magnitudePctMean}% of mean
            </p>
            <p className="mt-1">Resolves {prediction.resolutionDate}</p>
          </div>
        ) : null}
      </div>
      <PredictionPanelView
        key={`${prediction?.id ?? projection.metricName}:${outcome.hasMeasurement ? "measured" : "pending"}`}
        defaultView={defaultView}
        outcome={outcome}
        projection={projection}
        liveCommitment={liveCommitment}
      />
    </Panel>
  );
}
