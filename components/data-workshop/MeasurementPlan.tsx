"use client";

import { useActionState } from "react";
import { registerMeasurementPlan, recordMeasurementExposure } from "@/app/(dashboard)/data-workshop/measurement-actions";

const initial = { ok: false, message: "" };
const inputClass = "mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-sm";
export type RegisteredPlanSummary = {
  planId: string; exposureStart: string; windowStart: string; windowEnd: string;
  lagDays: number; population: string; threshold: number; concurrentStatus: string;
};

export function MeasurementPlan({ activationId, plan, actions }: {
  activationId: string;
  plan: RegisteredPlanSummary | null;
  actions: { id: string; label: string; exposure: { first: string; full: string } | null }[];
}) {
  const [state, register, pending] = useActionState(registerMeasurementPlan, initial);
  const [exposureState, record, recording] = useActionState(recordMeasurementExposure, initial);
  const remaining = actions.filter((action) => !action.exposure);
  return (
    <section className="space-y-4" aria-labelledby="measurement-title">
      <h2 id="measurement-title" className="font-semibold">Observational measurement plan</h2>
      <p className="max-w-3xl text-sm text-[var(--text-muted)]">
        Register the primary outcome before customer exposure. The result describes the level change around one coherent rollout.
        It cannot establish the contribution of individual actions or AI. Other changes at the same time can prevent attribution.
      </p>
      {plan ? (
        <>
          <dl className="grid gap-3 rounded-lg bg-[var(--surface-muted)] p-3 text-sm sm:grid-cols-2">
            <div><dt className="text-[var(--text-muted)]">Planned exposure</dt><dd>{plan.exposureStart}</dd></div>
            <div><dt className="text-[var(--text-muted)]">Fixed measurement window</dt><dd>{plan.windowStart} – {plan.windowEnd} · {plan.lagDays} day lag</dd></div>
            <div><dt className="text-[var(--text-muted)]">Exposed population</dt><dd>{plan.population}</dd></div>
            <div><dt className="text-[var(--text-muted)]">Decision threshold</dt><dd>{plan.threshold} stored metric units</dd></div>
          </dl>
          <p className="text-sm">This plan is immutable. Use a new report iteration to change it. Record actual exposure separately from completion or merge dates.</p>
          {actions.some((action) => action.exposure) && (
            <ul className="space-y-1 text-sm">
              {actions.filter((action) => action.exposure).map((action) => (
                <li key={action.id}>{action.label}: first exposure {action.exposure!.first}; fully exposed {action.exposure!.full}</li>
              ))}
            </ul>
          )}
          {remaining.length > 0 ? (
            <form action={record} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="planId" value={plan.planId} />
              <label className="text-sm">Included action
                <select name="actionId" required defaultValue="" className={inputClass}>
                  <option value="">Choose action</option>
                  {remaining.map((action) => <option key={action.id} value={action.id}>{action.label}</option>)}
                </select>
              </label>
              <label className="text-sm">Exposure evidence reference<input name="source" required minLength={5} maxLength={1000} className={inputClass} /></label>
              <label className="text-sm">Actual first exposure<input name="firstExposure" type="date" required className={inputClass} /></label>
              <label className="text-sm">Actual full exposure<input name="fullExposure" type="date" required className={inputClass} /></label>
              <p className="text-sm text-[var(--text-muted)] sm:col-span-2">Record the dates as they happened. Staged exposure or dates differing from the plan cannot be estimated by this design.</p>
              <button disabled={recording} className="rounded-lg bg-[var(--brand-blue)] p-3 text-sm text-white disabled:opacity-50">{recording ? "Recording…" : "Confirm and record exposure"}</button>
            </form>
          ) : <p role="status" className="text-sm">Exposure is documented for every included action. Evaluation waits for the fixed review horizon.</p>}
        </>
      ) : (
        <form action={register} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="activationId" value={activationId} />
          <label className="text-sm">Planned first and full exposure<input name="exposureStart" type="date" required className={inputClass} /></label>
          <label className="text-sm">Baseline starts (45–180 days before)<input name="windowStart" type="date" required className={inputClass} /></label>
          <label className="text-sm">Fixed review horizon (45–180 post days)<input name="windowEnd" type="date" required className={inputClass} /></label>
          <label className="text-sm">Expected lag in days<input name="lagDays" type="number" min={0} max={30} step={1} defaultValue={0} required className={inputClass} /></label>
          <label className="text-sm">Decision threshold in stored metric units<input name="threshold" type="number" min={0} step="any" required className={inputClass} /></label>
          <label className="text-sm">Exposed population<input name="population" minLength={3} maxLength={500} required className={inputClass} /></label>
          <label className="text-sm">Planned exposure reference<input name="exposureSource" minLength={5} maxLength={1000} required className={inputClass} /></label>
          <label className="text-sm">Concurrent change assessment
            <select name="concurrentStatus" required defaultValue="" className={inputClass}>
              <option value="">Choose assessment</option><option value="none_known">No known concurrent change</option>
              <option value="present">Other changes expected</option><option value="unknown">Unknown</option>
            </select>
          </label>
          <label className="text-sm sm:col-span-2">Changes assessed and remaining limitations<textarea name="concurrentChanges" minLength={3} maxLength={2000} required className={inputClass} /></label>
          <button disabled={pending} className="rounded-lg bg-[var(--brand-blue)] p-3 text-sm text-white disabled:opacity-50">{pending ? "Registering…" : "Confirm and register plan"}</button>
        </form>
      )}
      {state.message && <p role="status" className="text-sm">{state.message}</p>}
      {exposureState.message && <p role="status" className="text-sm">{exposureState.message}</p>}
    </section>
  );
}
