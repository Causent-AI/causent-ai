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
    <section className="border-t border-[var(--border)] px-5 py-8 first:border-t-0 sm:px-9 sm:py-10">
      <header className="mb-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--brand-blue)]">
          {number.padStart(2, "0")}
        </p>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-[var(--text)]">{title}</h2>
          <p className="max-w-xl text-[12px] leading-5 text-[var(--text-muted)]">{description}</p>
        </div>
      </header>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}
