"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  DECISION_LOOP_REVIEW_MAX_BYTES,
  parseDecisionLoopReview,
  prepareDecisionLoopCopy,
  type DecisionLoopHandoff as DecisionLoopHandoffContract,
  type DecisionLoopCopyTarget,
  type DecisionLoopReview,
} from "@/lib/decision-reports/loop-handoff";

type CopyState = "idle" | "success" | "failure";

function targetLabel(target: DecisionLoopCopyTarget): "Claude" | "Codex" {
  return target === "claude" ? "Claude" : "Codex";
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function classificationLabel(
  classification: DecisionLoopHandoffContract["dataClassification"],
): string {
  switch (classification) {
    case "private":
      return "Private";
    case "organization":
      return "Organization";
    case "public":
      return "Public";
    default:
      return "Unclassified";
  }
}

function ReviewList({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <p className="text-[11px] text-[var(--text-subtle)]">{emptyLabel}</p>;
  }

  return (
    <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-5 text-[var(--text-muted)]">
      {items.map((item, index) => (
        <li key={`${index}:${item}`}>{item}</li>
      ))}
    </ul>
  );
}

function ParsedReview({
  review,
  headingId,
}: {
  review: DecisionLoopReview;
  headingId: string;
}) {
  return (
    <section
      className="mt-3 rounded-lg border border-teal-200 bg-teal-50/70 p-3"
      aria-labelledby={headingId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5
          id={headingId}
          className="text-[11px] font-semibold text-teal-950"
        >
          Parsed handback preview
        </h5>
        <span className="rounded-full border border-teal-200 bg-white px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-teal-800">
          Not saved
        </span>
      </div>

      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-teal-800">
            Outcome
          </dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 text-teal-950">
            {review.outcome}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-teal-800">
            Files changed
          </dt>
          <dd>
            <ReviewList items={review.filesChanged} emptyLabel="None reported." />
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-teal-800">
            Validation
          </dt>
          <dd>
            <ReviewList items={review.validation} emptyLabel="None reported." />
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-teal-800">
            Remaining risks
          </dt>
          <dd>
            <ReviewList items={review.remainingRisks} emptyLabel="None reported." />
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-teal-800">
            PR or artifact URL
          </dt>
          <dd className="mt-1 break-all text-[11px] leading-5 text-[var(--text-muted)]">
            {review.artifactUrl ?? "None reported."}
          </dd>
        </div>
      </dl>

      <p className="mt-3 border-t border-teal-200 pt-2 text-[10px] leading-4 text-teal-900/80">
        This preview is held only in this browser tab. It does not update the report,
        complete the action, or trigger recomputation.
      </p>
    </section>
  );
}

function DecisionLoopHandoffInner({
  handoff,
  target,
  onClose,
}: {
  handoff: DecisionLoopHandoffContract;
  target: DecisionLoopCopyTarget;
  onClose: () => void;
}) {
  const id = useId();
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const [egressConfirmed, setEgressConfirmed] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [pastedReview, setPastedReview] = useState("");
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [review, setReview] = useState<DecisionLoopReview | null>(null);
  const reviewBytes = utf8ByteLength(pastedReview);
  const confirmationRequired = handoff.egress.requiresConfirmation;
  const copyEnabled = !confirmationRequired || egressConfirmed;
  const destination = targetLabel(target);
  const reportLabel = `${handoff.reportTitle}, iteration ${handoff.iterationNumber}`;
  const copyStatusId = `${id}-copy-status`;
  const reviewHelpId = `${id}-review-help`;
  const reviewCountId = `${id}-review-count`;
  const reviewErrorId = `${id}-review-error`;

  async function copyBrief() {
    const preparation = prepareDecisionLoopCopy(handoff, target, egressConfirmed);
    if (!preparation.ok) return;

    setCopyState("idle");
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(preparation.clipboardText);
      setCopyState("success");
    } catch {
      setCopyState("failure");
      requestAnimationFrame(() => {
        fallbackRef.current?.focus();
        fallbackRef.current?.select();
      });
    }
  }

  function updatePastedReview(nextValue: string) {
    setReview(null);
    setParseErrors([]);

    if (utf8ByteLength(nextValue) > DECISION_LOOP_REVIEW_MAX_BYTES) {
      setParseErrors([
        "The pasted handback is larger than 16 KiB. Ask the AI to return the bounded JSON handback described in the brief.",
      ]);
      return;
    }

    setPastedReview(nextValue);
  }

  function parseReview() {
    const result = parseDecisionLoopReview(
      pastedReview,
      handoff.contextFingerprint,
    );

    if (!result.ok) {
      setReview(null);
      setParseErrors(result.errors);
      return;
    }

    setParseErrors([]);
    setReview(result.review);
  }

  return (
    <section
      className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-[var(--surface)] p-4 sm:p-5"
      aria-labelledby={`${id}-title`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-indigo-700">
            Manual task handoff
          </p>
          <h4 id={`${id}-title`} className="mt-1 text-[13px] font-semibold text-[var(--text)]">
            Copy task instructions to {destination}
          </h4>
          <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">
            Causent prepares bounded agent instructions. Nothing is sent
            automatically, and {destination} receives no access to Causent.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-indigo-700">
            Clipboard only
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 rounded-lg border border-[var(--border)] px-3 text-[11px] font-semibold text-[var(--text-muted)] hover:bg-[var(--bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
          >
            Close
          </button>
        </div>
      </div>

      <dl className="mt-3 grid gap-2 rounded-lg border border-indigo-100 bg-white/70 p-3 text-[10px] sm:grid-cols-2">
        <div>
          <dt className="font-semibold uppercase tracking-wide text-[var(--text-subtle)]">Report</dt>
          <dd className="mt-0.5 break-words text-[var(--text-muted)]">{reportLabel}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-wide text-[var(--text-subtle)]">Action</dt>
          <dd className="mt-0.5 break-words text-[var(--text-muted)]">
            {handoff.actionDisplayCode ? `${handoff.actionDisplayCode} — ` : ""}
            {handoff.actionTitle}
          </dd>
        </div>
      </dl>

      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[10px] leading-4 text-amber-950">
        <p className="font-semibold">
          Data classification: {classificationLabel(handoff.dataClassification)}
        </p>
        <p className="mt-1">{handoff.egress.reason}</p>
        <p className="mt-1">
          Review your organization&apos;s AI policy before pasting private or
          organization data into {destination}.
        </p>
      </div>

      {confirmationRequired ? (
        <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-white p-3 text-[10px] leading-4 text-[var(--text-muted)]">
          <input
            type="checkbox"
            checked={egressConfirmed}
            onChange={(event) => {
              setEgressConfirmed(event.target.checked);
              setCopyState("idle");
            }}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-indigo-700"
          />
          <span>
            I reviewed this brief and confirm I am allowed to paste its{" "}
            {classificationLabel(handoff.dataClassification).toLowerCase()} report
            context into {destination}.
          </span>
        </label>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!copyEnabled}
          aria-describedby={copyState === "idle" ? undefined : copyStatusId}
          onClick={copyBrief}
          className="rounded-lg bg-indigo-700 px-3 py-2 text-[11px] font-semibold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Copy for {destination}
        </button>
        {!copyEnabled ? (
          <span className="text-[10px] text-amber-800">Confirm egress before copying.</span>
        ) : null}
      </div>

      <div id={copyStatusId} className="mt-2 min-h-4" aria-live="polite">
        {copyState === "success" ? (
          <p className="text-[10px] text-emerald-800" role="status">
            Copied for {destination}. Open {destination} and paste manually; nothing was sent.
          </p>
        ) : null}
        {copyState === "failure" ? (
          <p className="text-[10px] text-red-700" role="alert">
            Clipboard access is blocked. Select and copy the brief below.
          </p>
        ) : null}
      </div>

      {copyState === "failure" ? (
        <div className="mt-2">
          <label
            htmlFor={`${id}-fallback`}
            className="text-[10px] font-semibold text-[var(--text-muted)]"
          >
            {destination} task instructions — manual copy fallback
          </label>
          <textarea
            ref={fallbackRef}
            id={`${id}-fallback`}
            readOnly
            rows={8}
            value={handoff.clipboardText}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-1 block w-full resize-y rounded-lg border border-red-200 bg-white px-2.5 py-2 font-mono text-[10px] leading-4 text-[var(--text)] outline-none focus:border-red-400"
          />
        </div>
      ) : null}

      {copyEnabled ? (
        <details className="mt-2 rounded-lg border border-indigo-100 bg-white/60 px-3 py-2">
          <summary className="cursor-pointer text-[10px] font-semibold text-[var(--text-muted)]">
            Preview agent instructions
          </summary>
          <p className="mt-2 text-[10px] leading-4 text-[var(--text-subtle)]">
            This is the exact text the copy button places on your clipboard.
          </p>
          <pre
            aria-label="Implementation brief preview"
            className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--border)] bg-white p-2.5 font-mono text-[10px] leading-4 text-[var(--text-muted)]"
          >
            {handoff.clipboardText}
          </pre>
        </details>
      ) : (
        <p className="mt-2 text-[10px] text-[var(--text-subtle)]">
            The agent instructions preview unlocks after egress confirmation.
        </p>
      )}

      <div className="mt-4 border-t border-indigo-200 pt-4">
        <h4 className="text-[12px] font-semibold text-[var(--text)]">Bring the result back</h4>
        <p id={reviewHelpId} className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">
          Paste the bounded JSON handback from the AI workspace, then review it here.
          Causent does not save or apply it in this preview.
        </p>

        <label
          htmlFor={`${id}-review`}
          className="mt-3 block text-[10px] font-semibold text-[var(--text-muted)]"
        >
          Paste the agent&apos;s handback
        </label>
        <textarea
          id={`${id}-review`}
          value={pastedReview}
          rows={7}
          maxLength={DECISION_LOOP_REVIEW_MAX_BYTES}
          spellCheck={false}
          aria-invalid={parseErrors.length > 0}
          aria-describedby={`${reviewHelpId} ${reviewCountId}${parseErrors.length > 0 ? ` ${reviewErrorId}` : ""}`}
          placeholder='{"schemaVersion":1,"contextFingerprint":"…","outcome":"…"}'
          onPaste={(event) => {
            const incoming = event.clipboardData.getData("text/plain");
            const target = event.currentTarget;
            const start = target.selectionStart;
            const end = target.selectionEnd;
            const nextValue = `${pastedReview.slice(0, start)}${incoming}${pastedReview.slice(end)}`;
            if (utf8ByteLength(nextValue) > DECISION_LOOP_REVIEW_MAX_BYTES) {
              event.preventDefault();
              setReview(null);
              setParseErrors([
                "The pasted handback is larger than 16 KiB. Ask the AI to return the bounded JSON handback described in the brief.",
              ]);
            }
          }}
          onChange={(event) => updatePastedReview(event.target.value)}
          className="mt-1 block w-full resize-y rounded-lg border border-[var(--border)] bg-white px-2.5 py-2 font-mono text-[10px] leading-4 text-[var(--text)] outline-none focus:border-indigo-400 aria-[invalid=true]:border-red-300"
        />
        <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
          <p id={reviewCountId} className="text-[9px] text-[var(--text-subtle)]">
            {reviewBytes} / 16,384 bytes
          </p>
          <p className="text-[9px] text-[var(--text-subtle)]">
            Ephemeral: clears when this view is refreshed.
          </p>
        </div>

        {parseErrors.length > 0 ? (
          <div
            id={reviewErrorId}
            className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2"
            role="alert"
          >
            <p className="text-[10px] font-semibold text-red-800">
              This handback could not be reviewed.
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-[10px] leading-4 text-red-700">
              {parseErrors.map((error, index) => (
                <li key={`${index}:${error}`}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pastedReview.trim() === ""}
            onClick={parseReview}
            className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-[11px] font-semibold text-indigo-800 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Review pasted handback
          </button>
          {pastedReview !== "" ? (
            <button
              type="button"
              onClick={() => {
                setPastedReview("");
                setParseErrors([]);
                setReview(null);
              }}
              className="rounded-lg px-3 py-2 text-[11px] font-medium text-[var(--text-muted)] hover:bg-white/70"
            >
              Clear handback
            </button>
          ) : null}
        </div>

        {review ? (
          <ParsedReview review={review} headingId={`${id}-parsed-preview`} />
        ) : null}
      </div>
    </section>
  );
}

export function DecisionLoopHandoff({
  handoff,
  target,
  onClose,
}: {
  handoff: DecisionLoopHandoffContract;
  target: DecisionLoopCopyTarget;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label={`Copy task instructions to ${targetLabel(target)}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto max-h-[calc(100dvh-1rem)] w-[min(720px,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-0 shadow-2xl backdrop:bg-slate-950/40"
    >
      <DecisionLoopHandoffInner
        key={`${handoff.contextFingerprint}:${target}`}
        handoff={handoff}
        target={target}
        onClose={onClose}
      />
    </dialog>
  );
}
