import type { Direction } from "@/lib/types";

// Colorblind-safe direction encoding: glyph (▲/▼/–) + color + text label.
// Direction is the *metric movement*; `good` drives color so an inverted metric
// (churn ↑ = bad) reads correctly without relying on hue alone.

const GLYPH: Record<Direction, string> = {
  up: "▲",
  down: "▼",
  neutral: "–",
};

export function Delta({
  direction,
  label,
  good,
  size = "sm",
  className = "",
  tone = "auto",
}: {
  direction: Direction;
  label: string;
  good: boolean;
  size?: "xs" | "sm" | "md";
  className?: string;
  // "neutral" forces the neutral/slate color while keeping the directional glyph
  // (▲/▼) — for a FACT that is neither win nor loss (a baseline move, C5/#18). The
  // glyph + label still carry the direction; only the hue is held neutral.
  tone?: "auto" | "neutral";
}) {
  const isNeutral = direction === "neutral" || tone === "neutral";
  const color = isNeutral
    ? "text-[var(--neutral)]"
    : good
      ? "text-[var(--pos)]"
      : "text-[var(--neg)]";
  const text = size === "xs" ? "text-[11px]" : size === "md" ? "text-sm" : "text-[13px]";
  const glyph = size === "xs" ? "text-[8px]" : "text-[9px]";

  return (
    <span
      className={`inline-flex items-center gap-1 tabular-nums font-medium ${color} ${text} ${className}`}
    >
      <span className={glyph} aria-hidden="true">
        {GLYPH[direction]}
      </span>
      <span>{label}</span>
    </span>
  );
}
