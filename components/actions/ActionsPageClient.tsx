"use client";

import { useState } from "react";
import type { Action, Metric } from "@/lib/types";
import { Panel } from "@/components/ui/Panel";
import { ActionList } from "@/components/actions/ActionList";
import { DecisionEditor } from "@/components/actions/DecisionEditor";

// Client half of the Actions & Decisions tab: owns the selected-action state so the
// list stays click-to-select. Data is fetched on the server (lib/data) and passed in
// as plain props — this component never touches Supabase or the seed.

export function ActionsPageClient({
  actions,
  metrics,
}: {
  actions: Action[];
  metrics: Metric[];
}) {
  const [selectedId, setSelectedId] = useState(actions[0]?.id ?? "");
  const selected = actions.find((a) => a.id === selectedId) ?? actions[0];

  return (
    <div className="mx-auto grid h-full max-w-[1360px] grid-cols-1 gap-4 p-5 lg:grid-cols-[400px_1fr]">
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
  );
}
