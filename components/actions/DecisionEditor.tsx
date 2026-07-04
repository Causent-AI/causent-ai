import type { Action } from "@/lib/types";
import { metrics, metricById } from "@/lib/seed";
import { CheckIcon, ChevronIcon } from "@/components/ui/icons";

// The "why we built it" rationale surface. v1 is a read-oriented rich-text
// layout (the persisted field is actions.rationale_richtext); collaborative
// editing is deferred.

function defaultRationale(a: Action): NonNullable<Action["rationale"]> {
  const metric = metricById(a.primaryMetricId);
  return {
    hypothesis: `We expect "${a.title}" to move ${metric?.name ?? "the target metric"}.`,
    expectedMetricId: a.primaryMetricId,
    body: [
      "Document the decision behind this change here — the problem observed, the change made, and the metric you expect it to move.",
      "This rationale is captured as first-class data so the causal readout can be read alongside the intent, not just the outcome.",
    ],
  };
}

const TOOLBAR = ["B", "I", "U", "S"];

export function DecisionEditor({ action }: { action: Action }) {
  const r = action.rationale ?? defaultRationale(action);
  const expected = metricById(r.expectedMetricId);

  return (
    <div className="flex h-full flex-col">
      {/* title */}
      <div className="flex items-baseline gap-2">
        <h2 className="text-[22px] font-semibold tracking-tight text-[var(--text)]">
          {action.title}
        </h2>
        <span className="text-[14px] text-[var(--text-subtle)] tabular-nums">
          #{action.pr}
        </span>
      </div>
      <p className="mt-1 text-[14px] text-[var(--text-muted)]">Why did we build this?</p>

      {/* hypothesis + expected metric */}
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Hypothesis">
          <span className="truncate">{r.hypothesis}</span>
        </Field>
        <Field label="Expected metric">
          <span className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: expected?.color }}
              aria-hidden="true"
            />
            {expected?.name}
          </span>
        </Field>
      </div>

      {/* editor */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col rounded-lg border border-[var(--border)]">
        <div className="flex items-center gap-1 border-b border-[var(--border)] px-2 py-1.5 text-[var(--text-muted)]">
          <span className="flex items-center gap-1 rounded px-1.5 py-1 text-[12px] hover:bg-black/[0.04]">
            Paragraph <ChevronIcon size={12} />
          </span>
          <span className="mx-1 h-4 w-px bg-[var(--border)]" />
          {TOOLBAR.map((t) => (
            <button
              key={t}
              className="h-7 w-7 rounded text-[13px] font-semibold hover:bg-black/[0.04]"
              style={t === "I" ? { fontStyle: "italic" } : undefined}
            >
              {t}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-[var(--border)]" />
          <span className="text-[12px] text-[var(--text-subtle)]">
            ⌗ · ⌸ · 🔗 · ❝ · ↺
          </span>
        </div>

        <div className="scroll-slim min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-[14px] leading-relaxed text-[var(--text)]">
          {r.body.map((para, i) => (
            <p key={i} className={i === r.body.length - 1 ? "italic text-[var(--text-muted)]" : ""}>
              {para}
            </p>
          ))}
        </div>
      </div>

      {/* footer */}
      <div className="mt-2 flex items-center justify-between text-[12px] text-[var(--text-muted)]">
        <span className="flex items-center gap-1.5">
          <CheckIcon size={13} className="text-[var(--text-subtle)]" />
          Last saved just now
        </span>
        <span>Saved</span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[12px] text-[var(--text-muted)]">{label}</div>
      <div className="flex h-9 items-center justify-between rounded-lg border border-[var(--border)] px-3 text-[13px] text-[var(--text)]">
        <span className="min-w-0 truncate">{children}</span>
        <ChevronIcon size={14} className="ml-2 shrink-0 text-[var(--text-subtle)]" />
      </div>
    </div>
  );
}
