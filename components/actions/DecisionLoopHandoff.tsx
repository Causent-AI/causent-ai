"use client";

import { useEffect, useState } from "react";
import { prepareDecisionLoopCopy, type DecisionLoopHandoff, type DecisionLoopCopyTarget } from "@/lib/decision-reports/loop-handoff";

export function DecisionLoopCopyButton({ handoff, target }: { handoff: DecisionLoopHandoff; target: DecisionLoopCopyTarget }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state !== "copied") return;
    const timer = window.setTimeout(() => setState("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [state]);
  const label = target === "claude" ? "Claude" : "Codex";
  async function copy() {
    const prepared = prepareDecisionLoopCopy(handoff, target);
    if (!prepared.ok) return;
    setState("idle");
    try {
      await navigator.clipboard.writeText(prepared.clipboardText);
      setState("copied");
    } catch {
      setState("failed");
    }
  }
  return <span>
    <button type="button" onClick={copy} aria-label={`Copy ${handoff.actionTitle} task instructions to ${label}`}
      className="min-h-11 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-[10px] font-semibold text-indigo-800 hover:bg-indigo-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
      {state === "copied" ? "Copied" : label}
    </button>
    <span role="status" className="sr-only">{state === "copied" ? `Copied instructions for ${label}.` : ""}</span>
    {state === "failed" ? <label className="block text-xs text-red-700">Clipboard unavailable. Copy these instructions:
      <textarea readOnly value={handoff.clipboardText} rows={6} onFocus={(event) => event.currentTarget.select()} className="block w-full rounded border p-2" />
    </label> : null}
  </span>;
}
