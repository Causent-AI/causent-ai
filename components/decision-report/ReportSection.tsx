export function ReportSection({
  number,
  title,
  description,
  children,
}: {
  number: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm shadow-slate-200/40">
      <header className="border-b border-[var(--border)] bg-slate-50/70 px-4 py-3 sm:px-5">
        <div className="flex items-start gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--text)] text-[11px] font-semibold text-white">
            {number}
          </span>
          <div>
            <h2 className="text-[16px] font-semibold text-[var(--text)]">{title}</h2>
            <p className="text-[12px] leading-5 text-[var(--text-muted)]">{description}</p>
          </div>
        </div>
      </header>
      <div className="flex flex-col gap-3 p-4 sm:p-5">{children}</div>
    </section>
  );
}
