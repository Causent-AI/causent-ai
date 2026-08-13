import Link from "next/link";

import { MetricPredictionChart } from "@/components/decision-report/MetricPredictionChart";
import { ReportSection } from "@/components/decision-report/ReportSection";
import type { ReportActivationMetric } from "@/lib/decision-reports/materialization";
import type { MetricProjection } from "@/lib/decision-reports/schema";

export function ReportCoreMetricsSection({
  projection,
  metrics,
  metricId,
  reportId,
  readOnly,
  onMetricChange,
}: {
  projection: MetricProjection;
  metrics: ReportActivationMetric[];
  metricId: string;
  reportId: string | null;
  readOnly: boolean;
  onMetricChange: (metricId: string) => void;
}) {
  const metricMissing =
    !readOnly &&
    (metricId === "" || !metrics.some((metric) => metric.metricId === metricId));
  return (
    <ReportSection
      number="3"
      title="Core Metrics"
      description="Choose the metric this decision is expected to change."
    >
      <MetricPredictionChart projection={projection} />
      <div className={`rounded-xl border bg-white p-4 ${metricMissing ? "border-amber-400 bg-amber-50/40" : "border-[var(--border)]"}`}>
        {metrics.length > 0 ? (
          <label
            className="block text-[12px] font-semibold text-[var(--text)]"
            htmlFor="activation-metric"
          >
            Workspace metric
            <select
              id="activation-metric"
              className={`mt-2 block w-full rounded-lg border bg-white px-3 py-2.5 text-[13px] font-normal text-[var(--text)] disabled:bg-slate-50 ${metricMissing ? "border-amber-400" : "border-[var(--border)]"}`}
              aria-invalid={metricMissing}
              aria-describedby={metricMissing ? "activation-metric-required" : undefined}
              value={metricId}
              disabled={readOnly}
              onChange={(event) => onMetricChange(event.target.value)}
            >
              <option value="">Choose a metric…</option>
              {metrics.map((metric) => (
                <option key={metric.metricId} value={metric.metricId}>
                  {metric.name} · {metric.hasObservations ? "data connected" : "no observations"}
                </option>
              ))}
            </select>
            {metricMissing ? (
              <span id="activation-metric-required" className="mt-2 block text-[11px] font-medium text-amber-800">
                Choose the core metric required for activation.
              </span>
            ) : null}
          </label>
        ) : (
          <p className="text-[12px] text-amber-900">No workspace metric is available yet.</p>
        )}
        {!readOnly ? (
          <Link
            href={`/data-workshop${reportId ? `?returnTo=${encodeURIComponent(`/onboarding?report=${reportId}`)}` : ""}`}
            className="mt-3 inline-flex text-[11px] font-semibold text-[var(--brand-blue)] underline-offset-2 hover:underline"
          >
            {metrics.length === 0 ? "Import a metric in Data Workshop →" : "Manage metrics in Data Workshop →"}
          </Link>
        ) : null}
      </div>
    </ReportSection>
  );
}
