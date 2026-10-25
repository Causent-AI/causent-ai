import { staticDemoWorkspaceOption } from "@/lib/auth/workspace-selection";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { listAccessibleWorkspaces } from "@/lib/auth/workspace-context";
import { getServerSupabase } from "@/lib/supabase-server";
import { setMilestone } from "./server-actions";
import { ProjectPlanEditor } from "@/components/projects/ProjectPlanEditor";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
export default async function ProjectsPage() {
  if (process.env.CAUSENT_USE_SEED === "1") return <div className="workspace-page p-8"><div className="flex justify-between"><h1 className="text-2xl font-semibold">Projects</h1><Link className="button primary" href="/projects/new">New project</Link></div><ProjectPicker workspaces={[staticDemoWorkspaceOption()]} activeId={staticDemoWorkspaceOption().id} /><p className="mt-6">Sign in to save project goals, completion milestones, and planned metrics.</p><Link href="/reports">View reports</Link></div>;
  const session = await getSession();
  const sb = await getServerSupabase();
  const [workspaces, plan, milestones] = await Promise.all([
    listAccessibleWorkspaces(sb),
    sb.from("project_plans").select("goal, planned_metrics").eq("scope_id", session.workspaceId).maybeSingle(),
    sb.from("project_milestones").select("milestone_id, title, completed").eq("scope_id", session.workspaceId).order("created_at").order("milestone_id").limit(100),
  ]);
  const current = workspaces.find(w => w.id === session.workspaceId);
  const items = milestones.data ?? [];
  return <div className="workspace-page p-8">
    <div className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-2xl font-semibold">Projects</h1><Link className="button primary" href="/projects/new">New project</Link></div>
    <ProjectPicker workspaces={workspaces} activeId={session.workspaceId} />
    <section className="mt-8 rounded-xl border p-6"><h2 className="text-xl font-semibold">{current?.project ?? "Project"}</h2>
      {plan.error || milestones.error ? <p role="alert">Project setup could not be loaded. Please try again.</p> : <>
        <p className="mt-3">{plan.data?.goal ?? "Open reports to review this project’s existing work."}</p>
        {plan.data ? <>
          <h3 className="mt-6 font-semibold">Completion · {items.filter(item => item.completed).length} of {items.length}</h3>
          {items.length === 0 ? <p className="mt-2 text-sm">No completion milestones yet.</p> : <ul className="mt-3 space-y-2">{items.map(item => <li key={item.milestone_id}><form action={setMilestone} className="flex items-center gap-3">
            <input type="hidden" name="id" value={item.milestone_id} /><input type="hidden" name="completed" value={String(!item.completed)} />
            <button className="button" aria-label={`${item.completed ? "Reopen" : "Complete"} ${item.title}`}>{item.completed ? "✓ Complete" : "Mark complete"}</button><span>{item.title}</span>
          </form></li>)}</ul>}
          <ProjectPlanEditor mode="milestone" />
          <h3 className="mt-6 font-semibold">Planned performance metrics</h3>
          {(plan.data.planned_metrics as string[]).length ? <ul className="mt-2 list-disc pl-5">{(plan.data.planned_metrics as string[]).map((metric, i) => <li key={i}>{metric} · awaiting measurement</li>)}</ul> : <p className="mt-2 text-sm">Day 0: no performance metrics yet. Add measurement setup as part of your project.</p>}
          <ProjectPlanEditor mode="metrics" metrics={plan.data.planned_metrics as string[]} />
          <Link className="button mt-4 inline-flex" href="/data-workshop?add=metric">Set up measurement</Link>
        </> : null}
      </>}
      <div className="mt-6 flex gap-4"><Link href="/reports">View reports</Link><Link href="/onboarding">New report</Link></div>
    </section>
  </div>;
}
