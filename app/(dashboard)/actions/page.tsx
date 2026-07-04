"use client";

import { useState } from "react";
import { actions } from "@/lib/seed";
import { Panel } from "@/components/ui/Panel";
import { ActionList } from "@/components/actions/ActionList";
import { DecisionEditor } from "@/components/actions/DecisionEditor";

export default function ActionsPage() {
  const [selectedId, setSelectedId] = useState(actions[0].id);
  const selected = actions.find((a) => a.id === selectedId) ?? actions[0];

  return (
    <div className="mx-auto grid h-full max-w-[1360px] grid-cols-1 gap-4 p-5 lg:grid-cols-[400px_1fr]">
      <Panel className="flex min-h-0 flex-col">
        <ActionList actions={actions} selectedId={selectedId} onSelect={setSelectedId} />
      </Panel>
      <Panel className="flex min-h-0 flex-col">
        <DecisionEditor action={selected} />
      </Panel>
    </div>
  );
}
