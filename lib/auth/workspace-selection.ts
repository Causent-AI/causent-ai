import {
  DEMO_WORKSPACES,
  demoWorkspaceById,
  type DemoWorkspaceId,
} from "../data/config.ts";

export type AccessibleWorkspace = {
  id: DemoWorkspaceId;
  project: string;
  workspace: string;
};

export type AccessibleWorkspaceRow = {
  workspace_id: string;
  name: string;
  projects: { name: string } | null;
};

export function staticDemoWorkspaceOption(): AccessibleWorkspace {
  const workspace = DEMO_WORKSPACES[0];
  return {
    id: workspace.id,
    project: workspace.project,
    workspace: workspace.workspace,
  };
}

/**
 * Reduce database rows to the server-owned fixture registry. Unknown rows are
 * discarded, display fallbacks come from the registry, and registry order is
 * stable regardless of the database response order.
 */
export function mapAccessibleDemoWorkspaces(
  rows: readonly AccessibleWorkspaceRow[],
): AccessibleWorkspace[] {
  const byId = new Map(
    rows.flatMap((row) => {
      const registered = demoWorkspaceById(row.workspace_id);
      if (!registered) return [];
      return [[registered.id, {
        id: registered.id,
        project: row.projects?.name ?? registered.project,
        workspace: row.name || registered.workspace,
      }] as const];
    }),
  );

  return DEMO_WORKSPACES.flatMap((workspace) => {
    const accessible = byId.get(workspace.id);
    return accessible ? [accessible] : [];
  });
}

/**
 * Resolve an untrusted cookie or form value against the server-owned demo
 * registry and the workspaces the current caller can actually read.
 */
export function selectDemoWorkspaceId(
  requestedWorkspaceId: unknown,
  accessibleWorkspaceIds: readonly string[],
): DemoWorkspaceId | null {
  const accessible = new Set(accessibleWorkspaceIds);
  const requested = demoWorkspaceById(requestedWorkspaceId);
  if (requested && accessible.has(requested.id)) return requested.id;

  const fallback = DEMO_WORKSPACES.find((workspace) => accessible.has(workspace.id));
  return fallback?.id ?? null;
}
