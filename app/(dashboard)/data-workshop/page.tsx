import { loadDashboardData } from "@/lib/data/dashboard";
import { Panel } from "@/components/ui/Panel";
import { CsvDropzone } from "@/components/data-workshop/CsvDropzone";
import { ConnectedMetrics } from "@/components/data-workshop/ConnectedMetrics";
import { PlusIcon } from "@/components/ui/icons";

const CAP = 5;

function ProgressRing({ value, cap }: { value: number; cap: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const filled = (value / cap) * c;
  return (
    <svg width="52" height="52" viewBox="0 0 52 52">
      <circle cx="26" cy="26" r={r} fill="none" stroke="var(--border)" strokeWidth="5" />
      <circle
        cx="26"
        cy="26"
        r={r}
        fill="none"
        stroke="var(--brand-teal)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${c}`}
        transform="rotate(-90 26 26)"
      />
      <text
        x="26"
        y="26"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-[var(--text)] text-[12px] font-semibold"
      >
        {value}/{cap}
      </text>
    </svg>
  );
}

export default async function DataWorkshopPage() {
  const { metrics } = await loadDashboardData();

  return (
    <div className="mx-auto grid max-w-[1360px] grid-cols-1 gap-4 p-5 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <Panel>
          <CsvDropzone />
        </Panel>
        <Panel>
          <ConnectedMetrics metrics={metrics} />
        </Panel>
      </div>

      {/* summary */}
      <Panel className="h-fit">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-[14px] font-semibold text-[var(--text)]">
              Core Metrics Summary
            </h3>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-[28px] font-bold tabular-nums text-[var(--text)]">
                {metrics.length}
              </span>
              <span className="text-[13px] text-[var(--text-muted)]">
                /{CAP} metrics connected
              </span>
            </div>
          </div>
          <ProgressRing value={metrics.length} cap={CAP} />
        </div>

        <div className="mt-4 space-y-2.5 border-t border-[var(--border)] pt-4">
          {metrics.map((m) => (
            <div key={m.id} className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span
                  className="h-2.5 w-4 rounded-full"
                  style={{ background: m.color }}
                  aria-hidden="true"
                />
                <span className="text-[13px] text-[var(--text)]">{m.name}</span>
              </div>
              <span className="text-[12px] text-[var(--text-muted)]">{m.cadence}</span>
            </div>
          ))}
        </div>

        <button className="mt-4 flex w-full flex-col items-center gap-0.5 rounded-lg border border-dashed border-[var(--border-strong)] py-3 text-[var(--brand-blue)] hover:bg-black/[0.02]">
          <span className="flex items-center gap-1.5 text-[13px] font-medium">
            <PlusIcon size={14} /> Add / Layer Metric
          </span>
          <span className="text-[11px] text-[var(--text-subtle)]">
            {metrics.length} of {CAP} added
          </span>
        </button>
      </Panel>
    </div>
  );
}
