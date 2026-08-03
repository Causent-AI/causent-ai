"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function OnboardingError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[onboarding] route render failed", error);
  }, [error]);

  return (
    <section
      className="mx-auto my-10 w-full max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm"
      role="alert"
    >
      <h1 className="text-[24px] font-semibold text-[var(--text)]">
        The Decision Report could not be loaded
      </h1>
      <p className="mt-2 text-[13px] leading-6 text-[var(--text-muted)]">
        Your draft and saved revisions were not changed. This may be a temporary workspace-data problem.
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
          href="/reports"
          className="rounded-lg border border-[var(--border)] bg-white px-4 py-2.5 text-[13px] font-semibold text-[var(--text)]"
        >
          Return to Reports
        </Link>
      </div>
    </section>
  );
}
