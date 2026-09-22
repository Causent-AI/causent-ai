"use client";

import Link from "next/link";
import Image from "next/image";
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
        <Image
          src="/causent-horizontal.svg"
          alt="Causent"
          width={158}
          height={27}
          priority
        />
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
          <summary className="button primary">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.65"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Create
          </summary>
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
