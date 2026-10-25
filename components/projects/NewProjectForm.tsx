"use client";
import { useActionState } from "react";
import { createProject } from "@/app/(dashboard)/projects/server-actions";
export function NewProjectForm({ organizations, requestId }: { requestId: string; organizations: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createProject, { error: "" });
  return <form action={action} className="mt-6 grid max-w-2xl gap-5">
    <input type="hidden" name="requestId" value={requestId} />
    <label>Organization<select name="organization" required className="mt-1 block w-full rounded-lg border p-3">{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
    <label>Project title<input name="title" required maxLength={120} placeholder="Build a new website" className="mt-1 block w-full rounded-lg border p-3" /></label>
    <label>Goal<textarea name="goal" required maxLength={4000} rows={3} placeholder="What will this project accomplish?" className="mt-1 block w-full rounded-lg border p-3" /></label>
    <label>Completion milestones <span className="text-sm text-gray-500">(optional, one per line)</span><textarea name="milestones" rows={4} maxLength={9030} placeholder={"Website launched\nAnalytics installed\n5 pages published"} className="mt-1 block w-full rounded-lg border p-3" /></label>
    <label>Planned performance metrics <span className="text-sm text-gray-500">(optional, one per line)</span><textarea name="metrics" rows={3} maxLength={9030} placeholder={"Conversion rate\nWeekly visitors"} className="mt-1 block w-full rounded-lg border p-3" /></label>
    <p className="text-sm text-gray-500">No metrics yet? Start with your goal and add measurement as part of the work. Planned metrics do not require data.</p>
    {state.error ? <p role="alert">{state.error}</p> : null}
    <button disabled={pending || organizations.length === 0} className="button primary justify-self-start">{pending ? "Creating…" : "Create project"}</button>
  </form>;
}
