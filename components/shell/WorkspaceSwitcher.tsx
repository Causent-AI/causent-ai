"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import { selectWorkspaceAction } from "@/app/workspace-actions";
import type { AccessibleWorkspace } from "@/lib/auth/workspace-selection";
import {
  ACTIVE_WORKSPACE_CHANGED_EVENT,
  type ActiveWorkspaceChangedDetail,
} from "@/lib/auth/workspace-events";

export function WorkspaceSwitcher({
  activeWorkspaceId,
  workspaces,
}: {
  activeWorkspaceId: string;
  workspaces: AccessibleWorkspace[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [selected, setSelected] = useState(activeWorkspaceId);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (workspaces.length < 2) return null;

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Active workspace"
        value={pending ? selected : activeWorkspaceId}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value;
          setSelected(next);
          setError(null);
          startTransition(async () => {
            const result = await selectWorkspaceAction(next);
            if (!result.ok) {
              setSelected(activeWorkspaceId);
              setError(result.error);
              return;
            }
            window.dispatchEvent(
              new CustomEvent<ActiveWorkspaceChangedDetail>(
                ACTIVE_WORKSPACE_CHANGED_EVENT,
                { detail: { workspaceId: next } },
              ),
            );
            if (pathname === "/onboarding") {
              router.replace("/onboarding?flow=decision-report", { scroll: false });
              return;
            }
            router.refresh();
          });
        }}
        className="min-h-11 max-w-[9rem] rounded-lg border border-[var(--border)] bg-white px-2 text-[12px] font-semibold text-[var(--text)] disabled:opacity-60 sm:max-w-[13rem] sm:px-3"
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.project} / {workspace.workspace}
          </option>
        ))}
      </select>
      {error ? <span className="sr-only" role="alert">{error}</span> : null}
    </div>
  );
}
