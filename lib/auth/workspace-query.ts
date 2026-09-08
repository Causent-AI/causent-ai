import type { SupabaseClient } from "@supabase/supabase-js";
import { collectKeyset } from "../data/keyset.ts";
import { DEMO_WORKSPACES } from "../data/config.ts";
import {
  mapAccessibleDemoWorkspaces,
  mapAccessibleWorkspaces,
  type AccessibleWorkspaceRow,
} from "./workspace-selection.ts";

/** Use a request-scoped client. Service-role access is only for explicit local demo. */
export async function readAccessibleWorkspaces(client: SupabaseClient, localDemo: boolean) {
  const result = await collectKeyset<AccessibleWorkspaceRow>((after, size) => {
    let query = client.from("workspaces")
      .select("workspace_id, name, projects(name)")
      .is("archived_at", null)
      .order("workspace_id").limit(size);
    if (localDemo) query = query.in("workspace_id", DEMO_WORKSPACES.map((workspace) => workspace.id));
    if (after) query = query.gt("workspace_id", after);
    return query as unknown as PromiseLike<{ data: AccessibleWorkspaceRow[] | null; error: unknown }>;
  }, (row) => row.workspace_id, 1000);
  return localDemo ? mapAccessibleDemoWorkspaces(result.rows) : mapAccessibleWorkspaces(result.rows);
}
