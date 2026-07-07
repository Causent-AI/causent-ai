import { FileCsvIcon } from "@/components/ui/icons";

// CSV-first metric onboarding. v1 is a visual affordance; wiring the parse +
// upsert into metric_observations comes with the ingestion task.

export function CsvDropzone() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--border-strong)] px-6 py-10 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)]">
        <FileCsvIcon />
      </div>
      <div className="text-[16px] font-semibold text-[var(--text)]">
        Drop a CSV here or click to browse
      </div>
      <div className="mt-1 text-[13px] text-[var(--text-muted)]">
        Expected format: <span className="font-mono">date,value</span> · daily
      </div>
      <button
        type="button"
        className="mt-4 rounded-lg bg-[var(--brand-blue)] px-4 py-2 text-[13px] font-semibold text-white hover:brightness-105"
      >
        Upload CSV
      </button>
    </div>
  );
}
