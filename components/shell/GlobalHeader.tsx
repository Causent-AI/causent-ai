import { Logo } from "@/components/shell/Logo";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { GearIcon, PlusIcon } from "@/components/ui/icons";

// Top global header row — sits above the tab strip. Static chrome for v1.

export function GlobalHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 sm:px-5">
      <Logo />

      <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
        <button
          type="button"
          aria-label="Settings"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-black/[0.04] hover:text-[var(--text)]"
        >
          <GearIcon />
        </button>

        <button
          type="button"
          aria-label="New Project"
          className="flex h-9 w-9 items-center justify-center gap-1.5 rounded-lg bg-[var(--brand-blue)] px-0 text-[13px] font-semibold text-white hover:brightness-105 sm:w-auto sm:px-3.5"
        >
          <span className="hidden sm:inline">New Project</span>
          <PlusIcon />
        </button>

        <AccountMenu />
      </div>
    </header>
  );
}
