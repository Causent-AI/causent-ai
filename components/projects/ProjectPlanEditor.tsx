"use client";
import { useActionState } from "react";
import { updateProjectPlan } from "@/app/(dashboard)/projects/server-actions";
export function ProjectPlanEditor({ metrics, mode }: { metrics?: string[]; mode: "metrics" | "milestone" }) {
  const [state, action, pending] = useActionState(updateProjectPlan, { error: "", saved: false });
  return <form action={action} className="mt-4 grid max-w-xl gap-2">
    <input type="hidden" name="mode" value={mode} />
    {mode === "metrics" ? <label>Plan measurement (one metric per line)<textarea name="metrics" defaultValue={metrics?.join("\n")} rows={3} maxLength={9030} className="mt-1 block w-full rounded-lg border p-3" /></label>
      : <label>Add a completion milestone<input name="milestone" required maxLength={300} className="mt-1 block w-full rounded-lg border p-3" placeholder="Analytics installed" /></label>}
    <button disabled={pending} className="button justify-self-start">{pending ? "Saving…" : mode === "metrics" ? "Save measurement plan" : "Add milestone"}</button>
    <p role="status">{state.error || (state.saved ? "Saved" : "")}</p>
  </form>;
}
