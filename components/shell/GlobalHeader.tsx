import { Logo } from "@/components/shell/Logo";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { WorkspaceSwitcher } from "@/components/shell/WorkspaceSwitcher";
import type { AccessibleWorkspace } from "@/lib/auth/workspace-selection";

// Top global header row — sits above the tab strip. Static chrome for v1.

export function GlobalHeader({
  activeWorkspaceId,
  workspaces,
}: {
  activeWorkspaceId: string;
  workspaces: AccessibleWorkspace[];
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 sm:px-5">
      <Logo compactOnMobile />

      <div className="flex shrink-0 items-center gap-2">
        <WorkspaceSwitcher
          key={activeWorkspaceId}
          activeWorkspaceId={activeWorkspaceId}
          workspaces={workspaces}
        />
        <AccountMenu />
      </div>
    </header>
  );
}
