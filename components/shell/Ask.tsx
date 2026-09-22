"use client";
import Link from "next/link";
import { useRef } from "react";
export function Ask() {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        className="ask-button"
        onClick={() => dialog.current?.showModal()}
      >
        ✦ Ask
      </button>
      <dialog ref={dialog} className="ask-dialog">
        <header className="flex items-center justify-between gap-4">
          <h2>What would you like to do?</h2>
          <button
            aria-label="Close Ask"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </header>
        <div className="ask-options">
          <Link href="/onboarding" onClick={() => dialog.current?.close()}>
            Generate a report{" "}
            <span>Describe your project and review an AI draft.</span>
          </Link>
          <Link href="/reports" onClick={() => dialog.current?.close()}>
            Edit a report{" "}
            <span>Use Rewrite to propose a change to a paragraph.</span>
          </Link>
          <Link
            href="/data-workshop?tab=ai"
            onClick={() => dialog.current?.close()}
          >
            Plan AI work{" "}
            <span>Review harnesses and estimate a task’s cost.</span>
          </Link>
        </div>
      </dialog>
    </>
  );
}
