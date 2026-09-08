"use server";

import { revalidatePath } from "next/cache";

import {
  listAccessibleWorkspaces,
  writeActiveWorkspaceCookie,
} from "@/lib/auth/workspace-context";
import { getServerSupabase, isLocalDemo } from "@/lib/supabase-server";

export type SelectWorkspaceResult =
  | { ok: true }
  | { ok: false; error: string };

export async function selectWorkspaceAction(
  requestedWorkspaceId: unknown,
): Promise<SelectWorkspaceResult> {
  if (typeof requestedWorkspaceId !== "string" ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestedWorkspaceId)) {
    return { ok: false, error: "That workspace is unavailable." };
  }

  const client = await getServerSupabase();
  if (!isLocalDemo()) {
    const auth = await client.auth.getUser();
    if (!auth.data.user) {
      return { ok: false, error: "Sign in before changing workspaces." };
    }
  }

  const accessible = await listAccessibleWorkspaces(client).catch(() => []);
  if (!accessible.some((workspace) => workspace.id === requestedWorkspaceId)) {
    return { ok: false, error: "That workspace is unavailable." };
  }

  await writeActiveWorkspaceCookie(requestedWorkspaceId);
  revalidatePath("/", "layout");
  revalidatePath("/onboarding");
  return { ok: true };
}
