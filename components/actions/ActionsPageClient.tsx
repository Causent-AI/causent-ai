"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Action, Metric, ProjectObjective } from "@/lib/types";
import { Panel } from "@/components/ui/Panel";
import { ActionList } from "@/components/actions/ActionList";
import { DecisionEditor } from "@/components/actions/DecisionEditor";
import { ObjectivePanel } from "@/components/actions/ObjectivePanel";

// Client half of the Actions & Decisions tab: owns the selected-action state so the
// list stays click-to-select. Data is fetched on the server (lib/data) and passed in
// as plain props — this component never touches Supabase or the seed.
// Deep-linkable: /actions?selected=<id> (e.g. from the Impact actions table) seeds
// and re-syncs the selection. Rendered inside <Suspense> (useSearchParams).

export function ActionsPageClient({
  actions,
  metrics,
  objective,
}: {
  actions: Action[];
  metrics: Metric[];
  objective: ProjectObjective | null;
}) {
  const searchParams = useSearchParams();
  const paramId = searchParams.get("selected");
  const validParamId =
    paramId && actions.some((a) => a.id === paramId) ? paramId : null;

  const [selectedId, setSelectedId] = useState(
    validParamId ?? actions[0]?.id ?? ""
  );

  // Re-sync when the URL changes while mounted (client-side nav to a new deep
  // link) — the render-time "adjust state when a prop changes" pattern.
  const [prevParamId, setPrevParamId] = useState(validParamId);
  if (validParamId !== prevParamId) {
    setPrevParamId(validParamId);
    if (validParamId) setSelectedId(validParamId);
  }

  const selected = actions.find((a) => a.id === selectedId) ?? actions[0];

  return (
    <div className="mx-auto flex h-full max-w-[1360px] flex-col gap-4 p-5">
      {objective && <ObjectivePanel objective={objective} />}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[400px_1fr]">
        <Panel className="flex min-h-0 flex-col">
          <ActionList
            actions={actions}
            metrics={metrics}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </Panel>
        <Panel className="flex min-h-0 flex-col">
          {selected && <DecisionEditor action={selected} metrics={metrics} />}
        </Panel>
      </div>
    </div>
  );
}
