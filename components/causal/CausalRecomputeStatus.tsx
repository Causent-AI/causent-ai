import type { CausalRecomputeStatus as Status } from "@/lib/data/causal-recompute-status";

const COPY: Record<Status["state"], { label: string; detail: string | null; tone: string }> = {
  idle: {
    label: "No causal update queued",
    detail: null,
    tone: "border-slate-200 bg-slate-50 text-slate-800",
  },
  queued: {
    label: "Causal update queued",
    detail: "New metric data, activation, or action completion is waiting for the background causal analysis. Existing readouts stay visible until the update completes.",
    tone: "border-blue-200 bg-blue-50 text-blue-900",
  },
  retrying: {
    label: "Causal update retrying",
    detail: "The last attempt did not complete. Causent will retry automatically; existing readouts are unchanged.",
    tone: "border-amber-200 bg-amber-50 text-amber-950",
  },
  current: {
    label: "Causal analysis current",
    detail: null,
    tone: "border-emerald-200 bg-emerald-50 text-emerald-950",
  },
  failed: {
    label: "Causal update needs attention",
    detail: "The automatic update exhausted its retries. Existing readouts are unchanged; an operator can inspect the worker safely.",
    tone: "border-rose-200 bg-rose-50 text-rose-950",
  },
};

function formattedTimestamp(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

export function CausalRecomputeStatus({ status }: { status: Status }) {
  if (status.state === "idle") return null;
  const copy = COPY[status.state];
  const timestamp = status.state === "current" || status.state === "failed"
    ? formattedTimestamp(status.lastProcessedAt)
    : formattedTimestamp(status.requestedAt);
  return (
    <aside className={`rounded-xl border px-4 py-3 ${copy.tone}`} aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[12px] font-semibold">{copy.label}</p>
        {timestamp ? <p className="text-[10px] opacity-70">{timestamp}</p> : null}
      </div>
      {copy.detail ? (
        <p className="mt-0.5 text-[11px] leading-5 opacity-80">{copy.detail}</p>
      ) : null}
    </aside>
  );
}
