export type WorkspaceBoundDraft = {
  workspaceId: string;
};

/** Keep a mounted draft only when it belongs to the newly active workspace. */
export function reconcileWorkspaceDraft<T extends WorkspaceBoundDraft>(
  draft: T | null,
  activeWorkspaceId: string,
): T | null {
  return draft?.workspaceId === activeWorkspaceId ? draft : null;
}
