import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase-server";
import { NewProjectForm } from "@/components/projects/NewProjectForm";
export default async function NewProjectPage() {
  if (process.env.CAUSENT_USE_SEED === "1") return <div className="workspace-page p-8"><Link href="/projects">← Projects</Link><h1 className="mt-4 text-2xl font-semibold">New project</h1><p>Sign in to create a saved project. No metrics or data are required to get started.</p><NewProjectForm organizations={[]} requestId={randomUUID()} /></div>;
  const sb = await getServerSupabase();
  const user = (await sb.auth.getUser()).data.user;
  const { data, error } = user ? await sb.from("memberships").select("org_id, orgs(name)").eq("user_id", user.id)
    .is("project_id", null).is("workspace_id", null).in("role", ["owner", "admin"]).limit(100) : { data: [], error: null };
  const organizations = (data ?? []).map(row => ({ id: row.org_id as string, name: (row.orgs as unknown as { name: string } | null)?.name ?? "Organization" }));
  return <div className="workspace-page p-8"><Link href="/projects">← Projects</Link><h1 className="mt-4 text-2xl font-semibold">New project</h1>
    <p className="mt-2">Define what you want to build. Create reports within the project when you are ready to analyze progress.</p>
    {error ? <p role="alert">Organizations could not be loaded. Please try again.</p> : organizations.length === 0 ? <p className="mt-4">Organization admin access is required to create a project.</p> : null}
    <NewProjectForm organizations={organizations} requestId={randomUUID()} />
  </div>;
}
