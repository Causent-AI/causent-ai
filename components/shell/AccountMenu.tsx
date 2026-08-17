"use client";

import { useEffect, useRef, useState } from "react";

// The header account chip. The demo menu only shows the available identity;
// unavailable account actions stay out of the interface.

const DEMO_USER = { initials: "AK", name: "Adam K.", detail: "Demo workspace" };

export function AccountMenu() {
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
        className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--brand-grey)] text-[12px] font-semibold text-white hover:brightness-110 sm:h-9 sm:w-9"
      >
        {DEMO_USER.initials}
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
              {DEMO_USER.name}
            </div>
            <div className="text-[12px] text-[var(--text-muted)]">
              {DEMO_USER.detail}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
