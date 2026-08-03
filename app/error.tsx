"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[app] route render failed", error);
  }, [error]);

  return (
    <main className="flex min-h-[70vh] items-center justify-center bg-[var(--bg)] px-4 py-12">
      <section
        className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm"
        role="alert"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">
          Causent
        </p>
        <h1 className="mt-2 text-[24px] font-semibold text-[var(--text)]">
          This view could not be loaded
        </h1>
        <p className="mt-2 text-[13px] leading-6 text-[var(--text-muted)]">
          Your saved reports and workspace data were not changed. Try loading the view again.
        </p>
        {error.digest ? (
          <p className="mt-2 text-[11px] text-[var(--text-subtle)]">
            Reference: {error.digest}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-[var(--text)] px-4 py-2.5 text-[13px] font-semibold text-white"
            onClick={() => unstable_retry()}
          >
            Try again
          </button>
          <Link
            href="/onboarding"
            className="rounded-lg border border-[var(--border)] bg-white px-4 py-2.5 text-[13px] font-semibold text-[var(--text)]"
          >
            Go to onboarding
          </Link>
        </div>
      </section>
    </main>
  );
}
