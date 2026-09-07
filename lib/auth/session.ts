// The session seam (#5 landed here). The single place the app resolves "who is
// here and which workspace do they act in". Both funnel and dashboard writes
// scope to session.workspaceId — unchanged callers.
//
// The untrusted workspace cookie is resolved against current membership through
// the request's RLS client. Only explicit local-demo mode uses fixture IDs.

import "server-only";

import { DEMO_SCOPE_ID } from "@/lib/data/config";
import {
  listAccessibleWorkspaces,
  readRequestedWorkspaceId,
} from "@/lib/auth/workspace-context";
import { selectAccessibleWorkspaceId, selectDemoWorkspaceId } from "@/lib/auth/workspace-selection";
import { getServerSupabase, isLocalDemo } from "@/lib/supabase-server";

export type CausentSession = {
  /** The verified workspace every read and write is scoped to. */
  workspaceId: string;
  /** The authenticated user id (populates committed_by); null in local demo. */
  userId: string | null;
};

/** The current session. */
export async function getSession(): Promise<CausentSession> {
  if (process.env.CAUSENT_USE_SEED === "1") {
    return { workspaceId: DEMO_SCOPE_ID, userId: null };
  }
  const sb = await getServerSupabase();
  const [requestedWorkspaceId, accessibleWorkspaces, authResult] = await Promise.all([
    readRequestedWorkspaceId(),
    listAccessibleWorkspaces(sb),
    isLocalDemo() ? Promise.resolve(null) : sb.auth.getUser(),
  ]);
  const selectWorkspace = isLocalDemo() ? selectDemoWorkspaceId : selectAccessibleWorkspaceId;
  const workspaceId = selectWorkspace(
    requestedWorkspaceId,
    accessibleWorkspaces.map((workspace) => workspace.id),
  );
  if (!workspaceId) {
    throw new Error("No accessible Causent workspace is available for this session.");
  }
  return {
    workspaceId,
    userId: authResult?.data.user?.id ?? null,
  };
}
