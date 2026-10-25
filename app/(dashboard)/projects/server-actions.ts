"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase, isLocalDemo } from "@/lib/supabase-server";
import { writeActiveWorkspaceCookie } from "@/lib/auth/workspace-context";
import { getSession } from "@/lib/auth/session";
import { parseProjectSetup } from "@/lib/projects/setup";

export async function createProject(_previous: { error: string }, form: FormData) {
  const parsed = parseProjectSetup(Object.fromEntries(["title", "goal", "metrics", "milestones"].map(key => [key, form.get(key)])) as { title: unknown; goal: unknown; metrics: unknown; milestones: unknown });
  if (!parsed.ok) return { error: parsed.error };
  if (isLocalDemo() || process.env.CAUSENT_USE_SEED === "1") return { error: "Sign in to create a saved project." };
  const sb = await getServerSupabase();
  if (!(await sb.auth.getUser()).data.user) return { error: "Sign in to create a project." };
  const org = form.get("organization"), requestId = form.get("requestId");
  if (typeof org !== "string" || typeof requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(requestId)) return { error: "Choose an organization and try again." };
  const { title, goal, metrics, milestones } = parsed.value;
  const result = await sb.rpc("create_day_zero_project_v1", { p_org_id: org, p_title: title, p_goal: goal, p_metrics: metrics, p_milestones: milestones, p_workspace_id: requestId });
  if (result.error || typeof result.data !== "string") return { error: "Project could not be saved. Check organization admin access and try again." };
  await writeActiveWorkspaceCookie(result.data);
  revalidatePath("/", "layout");
  redirect("/projects");
}

export async function setMilestone(form: FormData) {
  if (isLocalDemo() || process.env.CAUSENT_USE_SEED === "1") throw new Error("Sign in to update milestones.");
  const session = await getSession();
  if (!session.userId) throw new Error("Sign in to update milestones.");
  const sb = await getServerSupabase();
  const id = form.get("id");
  if (typeof id !== "string") throw new Error("Milestone unavailable.");
  const result = await sb.from("project_milestones").update({ completed: form.get("completed") === "true" })
    .eq("scope_id", session.workspaceId).eq("milestone_id", id).select("milestone_id").single();
  if (result.error) throw new Error("Milestone could not be updated.");
  revalidatePath("/projects");
}

export async function updateProjectPlan(_previous: { error: string; saved: boolean }, form: FormData) {
  if (isLocalDemo() || process.env.CAUSENT_USE_SEED === "1") return { error: "Sign in to update a project.", saved: false };
  const session = await getSession();
  if (!session.userId) return { error: "Sign in to update a project.", saved: false };
  const sb = await getServerSupabase();
  const mode = form.get("mode");
  const parsed = parseProjectSetup({ title: "Project", goal: "Update", metrics: mode === "metrics" ? form.get("metrics") : "", milestones: mode === "milestone" ? form.get("milestone") : "" });
  if (!parsed.ok) return { error: parsed.error, saved: false };
  if (mode === "metrics") {
    const result = await sb.from("project_plans").update({ planned_metrics: parsed.value.metrics }).eq("scope_id", session.workspaceId).select("scope_id").single();
    if (result.error) return { error: "Measurement plan could not be saved.", saved: false };
  } else if (mode === "milestone" && parsed.value.milestones.length === 1) {
    const result = await sb.from("project_milestones").insert({ scope_id: session.workspaceId, title: parsed.value.milestones[0] });
    if (result.error) return { error: "Milestone could not be added.", saved: false };
  } else return { error: "Enter one milestone.", saved: false };
  revalidatePath("/projects");
  return { error: "", saved: true };
}
