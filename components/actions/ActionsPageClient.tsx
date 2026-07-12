"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Action, Decision, Metric, ProjectObjective } from "@/lib/types";
import { Panel } from "@/components/ui/Panel";
import { ActionList } from "@/components/actions/ActionList";
import { ActionDetail } from "@/components/actions/ActionDetail";
import { DecisionDetail } from "@/components/actions/DecisionDetail";
import { DecisionList } from "@/components/actions/DecisionList";
import { ObjectivePanel } from "@/components/actions/ObjectivePanel";
import { PredictionCapture } from "@/components/actions/PredictionCapture";

// Client half of the Actions & Decisions tab, restructured around the intent
// layer (epic #6, #10): DECISIONS are the top-level list (each parenting its
// actions + predictions); actions not yet grouped under a decision stay
// reachable in an "Ungrouped actions" section. Data arrives as plain props.
//
// Deep-linkable: /actions?selected=<actionId> (e.g. from the Impact actions
// table) selects the action's PARENT DECISION when one exists (highlighting
// the action inside it), else the bare action. Rendered inside <Suspense>
// (useSearchParams).

type Selection = { kind: "decision" | "action"; id: string };

export function ActionsPageClient({
  actions,
  decisions,
  metrics,
  objective,
}: {
  actions: Action[];
  decisions: Decision[];
  metrics: Metric[];
  objective: ProjectObjective | null;
}) {
  const searchParams = useSearchParams();
  const paramId = searchParams.get("selected");

  const decisionByActionId = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of decisions) for (const id of d.actionIds) map.set(id, d.id);
    return map;
  }, [decisions]);

  const ungrouped = useMemo(
    () => actions.filter((a) => !decisionByActionId.has(a.id)),
    [actions, decisionByActionId],
  );

  function selectionForParam(id: string | null): Selection | null {
    if (!id) return null;
    if (decisions.some((d) => d.id === id)) return { kind: "decision", id };
    if (actions.some((a) => a.id === id)) {
      const parent = decisionByActionId.get(id);
      // An action inside a decision deep-links to the decision (the intent is
      // the unit); a bare action selects itself.
      return parent ? { kind: "decision", id: parent } : { kind: "action", id };
    }
    return null;
  }

  const paramSelection = selectionForParam(paramId);
  const fallback: Selection | null = decisions[0]
    ? { kind: "decision", id: decisions[0].id }
    : actions[0]
      ? { kind: "action", id: actions[0].id }
      : null;

  const [selected, setSelected] = useState<Selection | null>(paramSelection ?? fallback);
  const [capturing, setCapturing] = useState(false);

  // Re-sync when the URL changes while mounted (client-side nav to a new deep
  // link) — the render-time "adjust state when a prop changes" pattern.
  const [prevParamId, setPrevParamId] = useState(paramId);
  if (paramId !== prevParamId) {
    setPrevParamId(paramId);
    const next = selectionForParam(paramId);
    if (next) setSelected(next);
  }

  const selectedDecision =
    selected?.kind === "decision" ? decisions.find((d) => d.id === selected.id) : undefined;
  const selectedAction =
    selected?.kind === "action" ? actions.find((a) => a.id === selected.id) : undefined;

  return (
    <div className="mx-auto flex h-full max-w-[1360px] flex-col gap-4 p-5">
      {objective && <ObjectivePanel objective={objective} />}

      {capturing && (
        <PredictionCapture
          metrics={metrics}
          unassignedActions={ungrouped}
          onClose={() => setCapturing(false)}
        />
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[400px_1fr]">
        <Panel className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
              Decisions
            </h2>
            <button
              type="button"
              onClick={() => setCapturing(true)}
              className="rounded border border-[var(--border)] px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] hover:bg-[var(--bg)]"
            >
              + New decision
            </button>
          </div>
          <DecisionList
            decisions={decisions}
            metrics={metrics}
            selectedId={selected?.kind === "decision" ? selected.id : null}
            onSelect={(id) => setSelected({ kind: "decision", id })}
          />
          {ungrouped.length > 0 && (
            <>
              <h2 className="mt-2 text-[13px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                Ungrouped actions
              </h2>
              <ActionList
                actions={ungrouped}
                metrics={metrics}
                selectedId={selected?.kind === "action" ? selected.id : ""}
                onSelect={(id) => setSelected({ kind: "action", id })}
              />
            </>
          )}
        </Panel>
        <Panel className="flex min-h-0 flex-col">
          {selectedDecision && (
            <DecisionDetail
              decision={selectedDecision}
              actions={actions}
              metrics={metrics}
              onSelectAction={(id) => setSelected({ kind: "action", id })}
            />
          )}
          {selectedAction && <ActionDetail action={selectedAction} metrics={metrics} />}
          {!selectedDecision && !selectedAction && (
            <p className="text-[13px] text-[var(--text-subtle)]">
              Commit your first decision to start the graph.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
