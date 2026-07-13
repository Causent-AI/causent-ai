"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Metric, Prediction } from "@/lib/types";
import { presentDrift } from "@/lib/drift";
import { Delta } from "@/components/ui/Delta";
import { InfoIcon } from "@/components/ui/icons";
import { formatMetricValue, formatShortDate } from "@/lib/format";
import { validateRevision } from "@/lib/predictions";
import { revisePrediction } from "@/app/(dashboard)/actions/server-actions";

// The baseline-drift notice (C5/#18) — the demo's hero signal, rendered on the
// prediction card. Design (adamowens-main-design-20260712, Design review outcome):
//
//   - CALM assert-fact surface, NEVER an alarm. Soft info-blue + an "i" icon — no
//     red, no warning triangle. An alarm would visually "declare the prediction
//     dead"; this states a fact and hands the user a choice.
//   - Fact first ("baseline moved X -> Y"), the "measured against a different
//     baseline" line second, the choice last.
//   - The baseline-move delta is NEUTRAL/slate — a baseline move is neither win nor
//     loss. Glyph + label carry the direction; color stays neutral (colorblind-safe).
//   - "Restate prediction?" is a QUIET outlined action, not a loud CTA. The
//     "Jira: no change flagged" chip is muted, de-emphasized (proof of the moat,
//     not a competing element).
//   - Four states: fired (this notice) · not-fired (nothing) · no-baseline-yet
//     ("gathering baseline") · restate-clicked (the stub modal).

/** Muted diamond, evoking a Jira issue glyph — supporting proof, de-emphasized. */
function DiamondIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2 22 12 12 22 2 12z" />
    </svg>
  );
}

/** Circular restate arrow — a quiet secondary action, not a filled CTA. */
function RestateIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function RestateModal({
  prediction,
  onClose,
}: {
  prediction: Prediction;
  onClose: () => void;
}) {
  const router = useRouter();
  const [magnitude, setMagnitude] = useState(String(prediction.magnitudePctMean));
  const [reason, setReason] = useState(
    "The metric's baseline moved after commit — restating against the new baseline.",
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  function submit() {
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
        onClose();
        router.refresh();
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h4 className="text-[14px] font-semibold text-[var(--text)]">Restate prediction</h4>
        <p className="mt-1 text-[12px] leading-snug text-[var(--text-muted)]">
          A restatement is data, not a failure — it is logged with a reason and the
          original stands in the record.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <label
            htmlFor={`restate-mag-${prediction.id}`}
            className="text-[12px] text-[var(--text-muted)]"
          >
            New magnitude (% of mean)
          </label>
          <input
            id={`restate-mag-${prediction.id}`}
            value={magnitude}
            onChange={(e) => setMagnitude(e.target.value)}
            inputMode="decimal"
            className="w-24 rounded border border-[var(--border)] px-2 py-1 text-[12px] tabular-nums"
          />
        </div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="mt-2 w-full rounded border border-[var(--border)] px-2 py-1 text-[12px]"
        />
        {errors.map((e, i) => (
          <p key={i} className="mt-1 text-[11px] text-[var(--neg)]">
            {e}
          </p>
        ))}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-[var(--border)] px-2.5 py-1 text-[12px]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={submit}
            className="rounded bg-[var(--brand-blue)] px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Log restatement"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DriftNotice({
  prediction,
  metric,
}: {
  prediction: Prediction;
  metric: Metric | undefined;
}) {
  const [restating, setRestating] = useState(false);
  const p = presentDrift(prediction.drift);
  const format = metric?.format ?? "percent";
  const metricName = metric?.name ?? prediction.metricId;

  if (p.kind === "none") return null;

  if (p.kind === "gathering") {
    // no-baseline-yet: a declared metric or too-few points — never a fire.
    return (
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--text-subtle)]">
        <InfoIcon size={13} className="shrink-0" />
        <span>Gathering baseline — not enough history yet to check for drift.</span>
      </div>
    );
  }

  const dirUp = prediction.direction === "POSITIVE";
  const targetLabel = `${dirUp ? "+" : "−"}${prediction.magnitudePctMean}%`;

  return (
    <div
      data-testid="drift-notice-fired"
      className="mt-2.5 rounded-xl border border-[var(--brand-blue)]/25 bg-[var(--brand-blue)]/[0.06] p-3.5"
    >
      <div className="flex gap-2.5">
        <InfoIcon size={18} className="mt-0.5 shrink-0 text-[var(--brand-blue)]" />
        <div className="min-w-0 flex-1">
          {/* Fact first: the baseline move, stated plainly. */}
          <p className="text-[13px] leading-relaxed text-[var(--text)]">
            Since you committed, <span className="font-medium">{metricName}</span>&rsquo;s
            baseline moved{" "}
            <span className="font-semibold tabular-nums">
              {formatMetricValue(p.preLevel, format)}
            </span>
            <span className="mx-1 text-[var(--text-subtle)]">→</span>
            <span className="inline-flex items-center gap-2 align-middle">
              <Delta
                direction={p.direction}
                tone="neutral"
                good
                size="md"
                label={formatMetricValue(p.postLevel, format)}
              />
              <span className="rounded border border-[var(--neutral)]/30 bg-[var(--neutral)]/[0.06] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--neutral)]">
                {p.moveLabel}
              </span>
            </span>
            {p.shiftDate && (
              <span className="ml-1 text-[11px] text-[var(--text-subtle)]">
                (since {formatShortDate(p.shiftDate)})
              </span>
            )}
          </p>

          {/* The consequence, second. */}
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-muted)]">
            Your <span className="font-medium text-[var(--text)]">{targetLabel}</span> target
            is now measured against a different baseline.
          </p>

          {/* The choice, last: a quiet action + the muted moat chip. */}
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setRestating(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--brand-blue)]/40 px-2.5 py-1 text-[12px] font-medium text-[var(--brand-blue)] hover:bg-[var(--brand-blue)]/[0.08]"
            >
              <RestateIcon />
              Restate prediction?
            </button>
            <span
              title="Jira and Linear track ticket state, not the metric's own baseline — they flag nothing here."
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--neutral)]/[0.08] px-2 py-1 text-[11px] text-[var(--text-subtle)]"
            >
              <DiamondIcon />
              Jira: no change flagged
            </span>
          </div>
        </div>
      </div>

      {restating && (
        <RestateModal prediction={prediction} onClose={() => setRestating(false)} />
      )}
    </div>
  );
}
