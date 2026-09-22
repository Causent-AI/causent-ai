"use client";
import { useEffect, useRef, type ReactNode } from "react";
import type { Metric } from "@/lib/types";
import { formatMetricValue } from "@/lib/format";
import { metricLibrarySummary } from "@/lib/metrics/library-summary";
import { Sparkline } from "@/components/charts/Sparkline";
import { useMetricInspection } from "@/components/shell/WorkspaceMetrics";
import { CoreMetricToggle } from "./CoreMetricToggle";

export function MetricLibrary({
  records,
  importer,
  initiallyOpen = false,
}: {
  records: Array<{ metricId: string; metric: Metric; isCore: boolean }>;
  importer: ReactNode;
  initiallyOpen?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const inspection = useMetricInspection();
  useEffect(() => {
    if (initiallyOpen) dialog.current?.showModal();
  }, [initiallyOpen]);
  return (
    <section className="metric-library">
      <div className="section-heading">
        <h2>Metric Library</h2>
        <button className="button" onClick={() => dialog.current?.showModal()}>
          ＋ Metric
        </button>
      </div>
      <dialog className="metric-dialog" ref={dialog}>
        <header className="section-heading">
          <h2>Add metric</h2>
          <button
            aria-label="Close metric import"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </header>
        {importer}
      </dialog>
      <div className="metric-library-scroll">
        <table className="metric-library-table" aria-label="Project metrics">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Latest</th>
              <th>L28 Avg</th>
              <th>WoW Trend</th>
              <th>Date Range</th>
            </tr>
          </thead>
          <tbody>
            {records.map(({ metric, metricId }) => {
              const summary = metricLibrarySummary(metric.series);
              const value = (v: number | null) =>
                v === null
                  ? "—"
                  : formatMetricValue(v, metric.format, metric.percentScale);
              return (
                <tr
                  key={metricId}
                  data-selected={
                    inspection.metric?.id === metric.id || undefined
                  }
                >
                  <td>
                    <button
                      aria-label={`Explore ${metric.name}`}
                      onClick={() => inspection.inspect(metric)}
                    >
                      {metric.name}
                    </button>
                  </td>
                  <td>{value(summary.latest)}</td>
                  <td title="Average of 28 complete daily observations, ending at the latest date">
                    {value(summary.average)}
                  </td>
                  <td>
                    <div className="metric-trend">
                      {metric.series.length > 1 && (
                        <Sparkline
                          series={metric.series.slice(-28)}
                          color="#377ded"
                          width={64}
                          height={24}
                        />
                      )}
                      <span title="Last 7 days versus the previous 7 days; both windows must be complete">
                        {summary.wow === null
                          ? "—"
                          : `${summary.wow > 0 ? "+" : ""}${summary.wow.toFixed(1)}%`}
                      </span>
                    </div>
                  </td>
                  <td>
                    {metric.series.length
                      ? `${metric.series[0].date} – ${metric.series.at(-1)!.date}`
                      : "No data"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!records.length && (
        <p className="empty-library">Add a metric to start your library.</p>
      )}
      <details className="core-metric-selection">
        <summary>
          Core metrics <span>{records.filter((r) => r.isCore).length}/5</span>
        </summary>
        <div>
          {records.map(({ metricId, metric, isCore }) => (
            <div className="core-metric-option" key={metricId}>
              <span>{metric.name}</span>
              <CoreMetricToggle
                metricId={metricId}
                metricName={metric.name}
                selected={isCore}
              />
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
