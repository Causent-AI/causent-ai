import type { Metric } from "@/lib/types";
import { formatLongDate } from "@/lib/format";
import { CoreMetricToggle } from "@/components/data-workshop/CoreMetricToggle";

function updatedLabel(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `${formatLongDate(iso.slice(0, 10))} ${time}`;
}

export function ConnectedMetrics({
  metrics,
  connectionSummary,
  removableMetricIdByName = {},
  lockedMetricName = null,
}: {
  metrics: Metric[];
  connectionSummary?: { connected: number; total: number };
  removableMetricIdByName?: Record<string, string>;
  lockedMetricName?: string | null;
}) {
  void connectionSummary;
  const unitLabel = (metric: Metric) =>
    metric.format === "currency" ? "USD" : metric.format === "percent" ? "Percent" : "Count";

  return (
    <div>
      <h3 className="mb-3 text-[13px] font-semibold text-[var(--text)]">
        Core Metrics
      </h3>
      <div className="overflow-x-auto">
        <table className="min-w-[600px] w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-[11px] font-medium uppercase tracking-wide text-[var(--text-subtle)]">
              <th className="py-2 pr-2 font-medium">Metric Name</th>
              <th className="px-2 py-2 font-medium">Unit</th>
              <th className="px-2 py-2 font-medium">Connection</th>
              <th className="px-2 py-2 font-medium">Last Updated</th>
              <th className="px-2 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.id} className="border-b border-[var(--border)] last:border-0">
                <td className="py-2.5 pr-2">
                  <span className="font-medium text-[var(--text)]">{m.name}</span>
                </td>
                <td className="px-2 py-2.5 text-[var(--text-muted)]">{unitLabel(m)}</td>
                <td className="px-2 py-2.5">
                  <span className="rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">
                    {m.source}
                  </span>
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 text-[var(--text-muted)]">
                  {updatedLabel(m.lastUpdated)}
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    {removableMetricIdByName[m.name] ? (
                      <CoreMetricToggle
                        metricId={removableMetricIdByName[m.name]}
                        metricName={m.name}
                        selected
                        appearance="remove"
                      />
                    ) : lockedMetricName === m.name ? (
                      <span className="text-[10px] font-medium text-[var(--text-subtle)]">Report metric</span>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
