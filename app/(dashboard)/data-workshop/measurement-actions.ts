"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/supabase-server";

export type MeasurementState = { message: string; ok: boolean };
const failed = (message: string): MeasurementState => ({ ok: false, message });
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function registerMeasurementPlan(_state: MeasurementState, form: FormData): Promise<MeasurementState> {
  const session = await getSession();
  if (!session.userId) return failed("Sign in to register a measurement plan.");
  const sb = await getServerSupabase();
  const text = (name: string) => String(form.get(name) ?? "").trim();
  if (!uuid(text("activationId"))) return failed("This activation is unavailable.");
  const activation = await sb.from("decision_report_activations").select("activation_id,metric_id")
    .eq("activation_id", text("activationId")).eq("scope_id", session.workspaceId).single();
  if (activation.error) return failed("This activation is unavailable.");
  const definition = await sb.from("metric_definitions").select("definition_id")
    .eq("metric_id", activation.data.metric_id).eq("scope_id", session.workspaceId).single();
  if (definition.error) return failed("First confirm the metric definition when importing its data.");
  const lag = Number(text("lagDays"));
  const threshold = Number(text("threshold"));
  if (!text("lagDays") || !Number.isInteger(lag) || lag < 0 || lag > 30 || !Number.isFinite(threshold) || threshold <= 0) {
    return failed("Use a lag of 0–30 whole days and a positive decision threshold.");
  }
  const { error } = await sb.from("measurement_plans").insert({
    scope_id: session.workspaceId, activation_id: activation.data.activation_id,
    metric_id: activation.data.metric_id, definition_id: definition.data.definition_id,
    design: "observational_its", estimand: "immediate_level_change",
    exposure_start: text("exposureStart"), exposure_end: text("exposureStart"),
    lag_days: lag, window_start: text("windowStart"), window_end: text("windowEnd"),
    population: text("population"), exposure_source: text("exposureSource"),
    concurrent_changes: text("concurrentChanges"), concurrent_change_status: text("concurrentStatus"),
    decision_threshold: threshold, registered_by: session.userId,
  });
  if (error) return failed("Plan not saved. Register the current report before exposure, allow 45–180 days per side, and complete every field. Use a new report iteration to revise an existing plan.");
  revalidatePath("/data-workshop");
  return { ok: true, message: "Plan registered. Record actual exposure after rollout. The fixed-horizon result will remain observational." };
}

export async function recordMeasurementExposure(_state: MeasurementState, form: FormData): Promise<MeasurementState> {
  const session = await getSession();
  if (!session.userId) return failed("Sign in to record exposure.");
  const sb = await getServerSupabase();
  const text = (name: string) => String(form.get(name) ?? "").trim();
  if (!uuid(text("planId")) || !uuid(text("actionId"))) return failed("Plan or action unavailable.");
  const plan = await sb.from("measurement_plans").select("plan_id")
    .eq("plan_id", text("planId")).eq("scope_id", session.workspaceId).single();
  if (plan.error) return failed("Plan unavailable.");
  const { error } = await sb.from("measurement_exposures").insert({
    plan_id: plan.data.plan_id, action_id: text("actionId"), scope_id: session.workspaceId,
    first_exposure: text("firstExposure"), fully_exposed: text("fullExposure"),
    source: text("source"), recorded_by: session.userId,
  });
  if (error) return failed("Exposure not saved. Select an included action, use past or current dates, and provide an evidence reference. Existing records are immutable.");
  revalidatePath("/data-workshop");
  return { ok: true, message: "Exposure recorded. Staged or changed exposure will produce a cannot-attribute result." };
}
