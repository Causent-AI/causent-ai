"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { selectWorkspaceAction } from "@/app/workspace-actions";
import type { AccessibleWorkspace } from "@/lib/auth/workspace-selection";
export function ProjectPicker({ workspaces, activeId }: { workspaces: AccessibleWorkspace[]; activeId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return <div className="mt-5"><ul className="flex flex-wrap gap-3">{workspaces.map(w => <li key={w.id}>
    <button disabled={pending} aria-pressed={w.id === activeId} className="button" onClick={() => start(async () => {
      setError("");
      const result = await selectWorkspaceAction(w.id);
      if (!result.ok) setError(result.error); else router.refresh();
    })}>{w.project}{w.workspace !== w.project ? ` · ${w.workspace}` : ""}</button>
  </li>)}</ul>{error ? <p role="alert">{error}</p> : null}</div>;
}
