"use client";
import { useRef, useState, useTransition } from "react";
import { generateDecisionReportAction } from "@/app/(onboarding)/onboarding/decision-report-actions";
import type { DecisionReportV1 } from "@/lib/decision-reports/schema";
export function ReportRewrite({
  report,
  disabled,
  onApply,
}: {
  report: DecisionReportV1;
  disabled: boolean;
  onApply: (id: string, text: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const claims = [
    ...report.decision.background,
    ...report.decision.problem,
    ...report.decision.decision,
    ...report.implementation.actionPlanSummary,
    ...report.implementation.actions.flatMap((a) => a.summary),
  ];
  const [claimId, setClaimId] = useState(claims[0]?.id ?? "");
  const [instruction, setInstruction] = useState(
    "Make this clearer and more concise. Preserve the facts and uncertainty.",
  );
  const [suggestion, setSuggestion] = useState<{
    claimId: string;
    original: string;
    text: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const request = useRef<{ signature: string; id: string } | null>(null);
  const claim = claims.find((c) => c.id === claimId);
  function rewrite() {
    if (!claim?.text.trim() || disabled) return;
    const original = claim.text;
    const brief = `Prepare a Decision Report paragraph rewrite. Put the rewritten paragraph in the decision claim, following the instruction below. Follow the required output schema and omit unrelated unsupported claims. Do not add facts, numerical results, or claims of evidence.\nInstruction: ${instruction}\nParagraph: ${original}`;
    if (brief.length > 6000) {
      setError("Choose a shorter paragraph (under 5,000 characters).");
      return;
    }
    if (request.current?.signature !== brief)
      request.current = { signature: brief, id: crypto.randomUUID() };
    const requestId = request.current.id;
    setError("");
    setSuggestion(null);
    startTransition(async () => {
      try {
        const data = new FormData();
        data.set("brief", brief);
        data.set("generationRequestId", requestId);
        const result = await generateDecisionReportAction(data);
        if (!result.ok) {
          if (!["running", "busy", "unavailable"].includes(result.code ?? ""))
            request.current = null;
          setError(result.error);
          return;
        }
        request.current = null;
        if (result.generation.mode !== "live") {
          setError("AI rewriting is unavailable. Your paragraph is unchanged.");
          return;
        }
        const text = result.generation.report.decision.decision
          .map((c) => c.text)
          .join("\n")
          .trim();
        if (!text) {
          setError("No rewrite returned. Try again.");
          return;
        }
        setSuggestion({ claimId, original, text });
      } catch {
        setError("Unable to get a rewrite. Your paragraph is unchanged.");
      }
    });
  }
  return (
    <>
      <button
        className="button"
        type="button"
        disabled={disabled}
        onClick={() => dialog.current?.showModal()}
      >
        ✦ Rewrite
      </button>
      <dialog className="rewrite-dialog" ref={dialog}>
        <header className="flex justify-between gap-4">
          <h2>Rewrite</h2>
          <button
            aria-label="Close rewrite"
            disabled={pending}
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </header>
        <label>
          Paragraph
          <select
            value={claimId}
            onChange={(e) => {
              setClaimId(e.target.value);
              setSuggestion(null);
            }}
            disabled={pending}
          >
            {claims.map((c, i) => (
              <option key={c.id} value={c.id}>
                {i + 1}. {c.text.slice(0, 65) || "Empty paragraph"}
              </option>
            ))}
          </select>
        </label>
        <blockquote>{claim?.text}</blockquote>
        <label>
          Instruction
          <textarea
            value={instruction}
            maxLength={800}
            onChange={(e) => {
              setInstruction(e.target.value);
              setSuggestion(null);
            }}
            disabled={pending}
          />
        </label>
        <p className="text-xs text-[var(--text-muted)]">
          This paragraph and instruction are sent to the configured AI provider.
          Review the result before applying.
        </p>
        <button
          className="button primary"
          disabled={
            pending || disabled || !claim?.text.trim() || !instruction.trim()
          }
          onClick={rewrite}
        >
          {pending ? "Rewriting…" : "Generate"}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {suggestion && (
          <section className="rewrite-preview">
            <h3>Proposed text</h3>
            <p>{suggestion.text}</p>
            <div className="flex gap-3">
              <button
                className="button primary"
                disabled={disabled}
                onClick={() => {
                  if (
                    claims.find((c) => c.id === suggestion.claimId)?.text !==
                    suggestion.original
                  ) {
                    setError(
                      "The paragraph changed. Generate a fresh rewrite first.",
                    );
                    return;
                  }
                  onApply(suggestion.claimId, suggestion.text);
                  setSuggestion(null);
                  dialog.current?.close();
                }}
              >
                Keep
              </button>
              <button className="button" onClick={() => setSuggestion(null)}>
                Discard
              </button>
            </div>
          </section>
        )}
      </dialog>
    </>
  );
}
