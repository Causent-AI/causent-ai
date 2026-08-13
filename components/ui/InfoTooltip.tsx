import { InfoIcon } from "@/components/ui/icons";

export function InfoTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group relative inline-flex">
      <summary className="flex min-h-9 min-w-9 cursor-pointer list-none items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-slate-100 hover:text-[var(--text)]" aria-label={label} title={label}>
        <InfoIcon size={16} />
      </summary>
      <div className="absolute right-0 top-10 z-20 w-72 rounded-xl border border-[var(--border)] bg-white p-3 text-[11px] leading-5 text-[var(--text-muted)] shadow-xl">
        {children}
      </div>
    </details>
  );
}
