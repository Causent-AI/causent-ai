"use client";

import Link from "next/link";
import { Logo } from "@/components/shell/Logo";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { WorkspaceSwitcher } from "@/components/shell/WorkspaceSwitcher";
import { TabStrip } from "@/components/shell/TabStrip";
import { useWorkspaceTitle } from "@/components/shell/WorkspaceTitle";
import type { AccessibleWorkspace } from "@/lib/auth/workspace-selection";

export function GlobalHeader({
  activeWorkspaceId,
  workspaces,
  account,
}: {
  activeWorkspaceId: string;
  workspaces: AccessibleWorkspace[];
  account?: { name: string; detail: string };
}) {
  const context = useWorkspaceTitle();
  const current = workspaces.find((w) => w.id === activeWorkspaceId);
  return (
    <header className="causent-topbar">
      <Link href="/reports" aria-label="Causent home" className="causent-brand">
        <Logo compactOnMobile />
      </Link>
      <div className="project-navigation">
        <details className="project-menu">
          <summary title={context?.title || current?.workspace}>
            <span>{context?.title || current?.workspace || "Projects"}</span>
            <span aria-hidden="true">›</span>
          </summary>
          <div className="shell-popover">
            <Link href="/reports">Reports</Link>
            <Link href="/onboarding">New report</Link>
            <WorkspaceSwitcher
              key={activeWorkspaceId}
              activeWorkspaceId={activeWorkspaceId}
              workspaces={workspaces}
            />
          </div>
        </details>
        <TabStrip />
      </div>
      <div className="shell-actions">
        <details className="create-menu">
          <summary className="button primary">＋ Create</summary>
          <div className="shell-popover">
            <Link href="/onboarding">Report</Link>
            <Link href="/data-workshop?add=metric">Metric</Link>
          </div>
        </details>
        <AccountMenu {...account} />
      </div>
    </header>
  );
}
