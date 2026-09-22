"use client";

import { useEffect, useRef, useState } from "react";

export function AccountMenu({
  name = "Account",
  detail = "Signed in",
}: {
  name?: string;
  detail?: string;
}) {
  const initials = name
    .split(/[ @._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative ml-1">
      <button
        type="button"
        aria-label="Account"
        aria-haspopup="dialog"
        aria-controls="account-details"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="account-avatar"
      >
        {initials}
      </button>

      {open && (
        <div
          id="account-details"
          role="dialog"
          aria-label="Account details"
          className="absolute right-0 top-12 z-50 w-56 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1.5 shadow-lg sm:top-10"
        >
          <div className="border-b border-[var(--border)] px-3.5 pb-2.5 pt-1.5">
            <div className="text-[13px] font-semibold text-[var(--text)]">
              {name}
            </div>
            <div className="text-[12px] text-[var(--text-muted)]">{detail}</div>
          </div>
        </div>
      )}
    </div>
  );
}
