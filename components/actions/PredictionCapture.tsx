"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Action, Metric } from "@/lib/types";
import type { ReferenceClassPriors } from "@/lib/priors";
import {
  predictionWarnings,
  validatePrediction,
  type PredictionInput,
} from "@/lib/predictions";
import {
  createDecisionWithPrediction,
  fetchPriors,
  proposeLever,
} from "@/app/(dashboard)/actions/server-actions";

// The capture flow (session-one artifact): decision → mechanism → the TEAM's
// number → resolution date → lever mapping. Elicit-not-assert is structural:
// the magnitude input is never pre-filled and the precedent panel only ever
// DESCRIBES what happened before ("no precedent yet — record your prior" on a
// thin graph). The lever proposal suggests WHICH ticket, never a number, and
// the human confirms by selecting it.

const MECHANISMS = ["activation", "monetization", "retention", "other"];

function PrecedentPanel({ priors }: { priors: ReferenceClassPriors | null }) {
  if (priors === null) {
    return (
      <p className="text-[12px] text-[var(--text-subtle)]">
        Pick a metric to see precedent from past resolutions.
      </p>
    );
  }
  if (!priors.hasPrecedent) {
    return (
      <p className="text-[12px] text-[var(--text-muted)]">
        No precedent yet — record your prior. Your resolved predictions become
        the base rate for the next one.
      </p>
    );
  }
  const br = priors.baseRate;
  const cal = priors.calibration;
  return (
    <div className="flex flex-col gap-1 text-[12px] text-[var(--text-muted)]">
      <p>
        {priors.supportCount} resolved prediction{priors.supportCount === 1 ? "" : "s"} in
        this class
        {Object.entries(priors.verdictCounts).length > 0 && (
          <span className="text-[var(--text-subtle)]">
            {" "}
            ({Object.entries(priors.verdictCounts)
              .map(([v, n]) => `${n} ${v.toLowerCase().replace(/_/g, " ")}`)
              .join(", ")})
          </span>
        )}
      </p>
      {br.weightedMeanPct !== null ? (
        <p>
          Measured lifts ran{" "}
          <span className="tabular-nums">
            {br.minPct?.toFixed(1)}% … {br.maxPct?.toFixed(1)}%
          </span>{" "}
          (belief-weighted mean {br.weightedMeanPct.toFixed(1)}%).
        </p>
      ) : (
        <p>Nothing in this class resolved with a confident measurement yet.</p>
      )}
      {cal.weightedMeanErrorPct !== null && (
        <p>
          This team{" "}
          {cal.weightedMeanErrorPct > 0 ? "over-predicts" : "under-predicts"} this class by{" "}
          <span className="tabular-nums">{Math.abs(cal.weightedMeanErrorPct).toFixed(1)}pp</span>{" "}
          on average.
        </p>
      )}
    </div>
  );
}

export function PredictionCapture({
  metrics,
  unassignedActions,
  onClose,
}: {
  metrics: Metric[];
  unassignedActions: Action[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [mechanism, setMechanism] = useState(MECHANISMS[0]);
  const [metricId, setMetricId] = useState("");
  const [direction, setDirection] = useState<"POSITIVE" | "NEGATIVE">("POSITIVE");
  const [magnitude, setMagnitude] = useState(""); // NEVER pre-filled — the team's number
  const [resolutionDate, setResolutionDate] = useState("");
  const [leverActionId, setLeverActionId] = useState<string | null>(null);
  const [suggestedLever, setSuggestedLever] = useState<string | null>(null);
  const [priors, setPriors] = useState<ReferenceClassPriors | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  // Precedent + lever hint follow the chosen reference class.
  useEffect(() => {
    if (!metricId) return;
    let stale = false;
    fetchPriors({ metricSlug: metricId, mechanismCategory: mechanism }).then((p) => {
      if (!stale) setPriors(p);
    });
    proposeLever({
      metricSlug: metricId,
      candidates: unassignedActions.map((a) => ({
        id: a.id,
        primaryMetricId: a.primaryMetricId,
        shippedAt: a.shippedAt,
      })),
    }).then((r) => {
      if (!stale) setSuggestedLever(r.suggestedActionId);
    });
    return () => {
      stale = true;
    };
  }, [metricId, mechanism, unassignedActions]);

  function input(): PredictionInput {
    return {
      metricId,
      direction,
      magnitudePctMean: Number(magnitude),
      resolutionDate,
      leverActionId,
    };
  }

  const warnings = predictionWarnings(input());

  function commit() {
    const errs = validatePrediction(input());
    if (!title.trim()) errs.unshift("Give the decision a title.");
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    startTransition(async () => {
      const res = await createDecisionWithPrediction({
        title,
        why,
        mechanismCategory: mechanism,
        prediction: input(),
      });
      if (!res.ok) setErrors(res.errors);
      else {
        onClose();
        router.refresh();
      }
    });
  }

  const field = "rounded border border-[var(--border)] px-2 py-1.5 text-[13px]";
  const label = "text-[11px] font-medium text-[var(--text-muted)]";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[15px] font-semibold text-[var(--text)]">
          What are you about to build, and what do you expect it to change?
        </h3>
        <button type="button" onClick={onClose} className="text-[12px] text-[var(--text-subtle)] hover:text-[var(--text)]">
          Cancel
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label className={label} htmlFor="capture-title">Decision</label>
        <input id="capture-title" className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Rebuild the signup funnel" />
      </div>

      <div className="flex flex-col gap-1">
        <label className={label} htmlFor="capture-why">Mechanism — what changes, and why would that move the metric?</label>
        <textarea id="capture-why" className={field} rows={2} value={why} onChange={(e) => setWhy(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label className={label} htmlFor="capture-metric">Metric</label>
          <select id="capture-metric" className={field} value={metricId} onChange={(e) => setMetricId(e.target.value)}>
            <option value="">Pick…</option>
            {metrics.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className={label} htmlFor="capture-mech">Mechanism class</label>
          <select id="capture-mech" className={field} value={mechanism} onChange={(e) => setMechanism(e.target.value)}>
            {MECHANISMS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className={label} htmlFor="capture-dir">Direction</label>
          <select id="capture-dir" className={field} value={direction} onChange={(e) => setDirection(e.target.value as "POSITIVE" | "NEGATIVE")}>
            <option value="POSITIVE">Up (positive)</option>
            <option value="NEGATIVE">Down (negative)</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className={label} htmlFor="capture-mag">Magnitude (% of mean)</label>
          <input
            id="capture-mag"
            className={`${field} tabular-nums`}
            inputMode="decimal"
            value={magnitude}
            onChange={(e) => setMagnitude(e.target.value)}
            placeholder="your team's number"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className={label} htmlFor="capture-date">Resolution date — when Causent measures it</label>
          <input id="capture-date" type="date" className={field} value={resolutionDate} onChange={(e) => setResolutionDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className={label} htmlFor="capture-lever">
            Lever — the action that carries the mechanism
            {suggestedLever && leverActionId === null && (
              <span className="ml-1 font-normal text-[var(--text-subtle)]">
                (suggested: {unassignedActions.find((a) => a.id === suggestedLever)?.title ?? suggestedLever} — confirm by selecting)
              </span>
            )}
          </label>
          <select id="capture-lever" className={field} value={leverActionId ?? ""} onChange={(e) => setLeverActionId(e.target.value || null)}>
            <option value="">No lever yet</option>
            {unassignedActions.map((a) => (
              <option key={a.id} value={a.id}>#{a.pr} {a.title}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded border border-dashed border-[var(--border)] p-3">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
          Precedent (informs — never authors — your number)
        </p>
        <PrecedentPanel priors={priors} />
      </div>

      {warnings.map((w, i) => (
        <p key={i} className="text-[12px] text-[var(--neg)]">⚠ {w}</p>
      ))}
      {errors.map((e, i) => (
        <p key={i} className="text-[12px] text-[var(--neg)]">{e}</p>
      ))}

      <div>
        <button
          type="button"
          disabled={pending}
          onClick={commit}
          className="rounded bg-[var(--text)] px-3 py-1.5 text-[13px] font-medium text-[var(--surface)] disabled:opacity-50"
        >
          {pending ? "Committing…" : "We predict — commit it"}
        </button>
      </div>
    </div>
  );
}
