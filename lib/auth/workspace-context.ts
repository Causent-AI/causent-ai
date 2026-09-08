import "server-only";

import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isLocalDemo } from "@/lib/supabase-server";
import { readAccessibleWorkspaces } from "./workspace-query";
import type { AccessibleWorkspace } from "./workspace-selection";

export const ACTIVE_WORKSPACE_COOKIE = "causent_active_workspace";

/**
 * Request-scoped RLS determines customer workspace visibility. Explicit local
 * demo mode retains its fixture allowlist despite its service-role client.
 */
export async function listAccessibleWorkspaces(
  client: SupabaseClient,
): Promise<AccessibleWorkspace[]> {
  return readAccessibleWorkspaces(client, isLocalDemo());
}

export async function readRequestedWorkspaceId(): Promise<string | null> {
  return (await cookies()).get(ACTIVE_WORKSPACE_COOKIE)?.value ?? null;
}

export async function writeActiveWorkspaceCookie(
  workspaceId: string,
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
