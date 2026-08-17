"use server";

import { revalidatePath } from "next/cache";

import {
  listAccessibleDemoWorkspaces,
  writeActiveWorkspaceCookie,
} from "@/lib/auth/workspace-context";
import { demoWorkspaceById } from "@/lib/data/config";
import { getServerSupabase, isLocalDemo } from "@/lib/supabase-server";

export type SelectWorkspaceResult =
  | { ok: true }
  | { ok: false; error: string };

export async function selectWorkspaceAction(
  requestedWorkspaceId: unknown,
): Promise<SelectWorkspaceResult> {
  const requested = demoWorkspaceById(requestedWorkspaceId);
  if (!requested) {
    return { ok: false, error: "That workspace is unavailable." };
  }

  const client = await getServerSupabase();
  if (!isLocalDemo()) {
    const auth = await client.auth.getUser();
    if (!auth.data.user) {
      return { ok: false, error: "Sign in before changing workspaces." };
    }
  }

  const accessible = await listAccessibleDemoWorkspaces(client).catch(() => []);
  if (!accessible.some((workspace) => workspace.id === requested.id)) {
    return { ok: false, error: "That workspace is unavailable." };
  }

  await writeActiveWorkspaceCookie(requested.id);
  revalidatePath("/", "layout");
  revalidatePath("/onboarding");
  return { ok: true };
}
