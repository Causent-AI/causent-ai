import type { PredictionVerdict } from "@/lib/types";
import { presentVerdict } from "@/lib/verdicts";

// Verdict chip: glyph + label + tone (triple-encoded, colorblind-safe — the
// same rule as Delta). The caveat is rendered by the parent so it can LEAD
// the readout; `title` carries it here for hover too.

const TONE_CLASS: Record<string, string> = {
  positive: "text-[var(--pos)] border-[var(--pos)]/30 bg-[var(--pos)]/5",
  negative: "text-[var(--neg)] border-[var(--neg)]/30 bg-[var(--neg)]/5",
  neutral: "text-[var(--text-muted)] border-[var(--border)] bg-transparent",
  plain: "text-[var(--text-subtle)] border-[var(--border)] bg-transparent",
};

export function VerdictBadge({
  verdict,
  size = "sm",
}: {
  verdict: PredictionVerdict;
  size?: "sm" | "md";
}) {
  const p = presentVerdict(verdict);
  const text = size === "md" ? "text-[13px]" : "text-[11px]";
  return (
    <span
      title={p.caveat}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${text} ${TONE_CLASS[p.tone]}`}
    >
      <span aria-hidden="true">{p.glyph}</span>
      <span>{p.label}</span>
    </span>
  );
}
