import "server-only";

import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEMO_WORKSPACES,
  type DemoWorkspaceId,
} from "@/lib/data/config";
import {
  mapAccessibleDemoWorkspaces,
  type AccessibleWorkspace,
  type AccessibleWorkspaceRow,
} from "@/lib/auth/workspace-selection";

export const ACTIVE_WORKSPACE_COOKIE = "causent_active_workspace";

/**
 * Return only registered demo workspaces visible through the supplied client.
 * In production RLS performs authorization. In local-demo service-role mode,
 * the registry itself is the fail-closed allowlist.
 */
export async function listAccessibleDemoWorkspaces(
  client: SupabaseClient,
): Promise<AccessibleWorkspace[]> {
  const ids = DEMO_WORKSPACES.map((workspace) => workspace.id);
  const response = await client
    .from("workspaces")
    .select("workspace_id, name, projects(name)")
    .in("workspace_id", ids);
  if (response.error) throw response.error;

  return mapAccessibleDemoWorkspaces(
    (response.data ?? []) as unknown as AccessibleWorkspaceRow[],
  );
}

export async function readRequestedWorkspaceId(): Promise<string | null> {
  return (await cookies()).get(ACTIVE_WORKSPACE_COOKIE)?.value ?? null;
}

export async function writeActiveWorkspaceCookie(
  workspaceId: DemoWorkspaceId,
): Promise<void> {
  (await cookies()).set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
    priority: "high",
  });
}
