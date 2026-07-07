import { Logo } from "@/components/shell/Logo";
import { GearIcon, PlusIcon, ReportIcon } from "@/components/ui/icons";

// Top global header row — sits above the tab strip. Static chrome for v1.

export function GlobalHeader() {
  return (
    <header className="flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-5">
      <Logo />

      <div className="flex items-center gap-2.5">
        <button
          type="button"
          aria-label="Settings"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-black/[0.04] hover:text-[var(--text)]"
        >
          <GearIcon />
        </button>

        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[13px] font-medium text-[var(--text)] hover:bg-black/[0.03]"
        >
          <ReportIcon />
          Create Report
        </button>

        <button
          type="button"
          className="flex h-9 items-center gap-1.5 rounded-lg bg-[var(--brand-blue)] px-3.5 text-[13px] font-semibold text-white hover:brightness-105"
        >
          New Project
          <PlusIcon />
        </button>

        <div className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand-grey)] text-[12px] font-semibold text-white">
          AK
        </div>
      </div>
    </header>
  );
}
