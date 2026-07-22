import type { Claim, ClaimStatus } from "@/lib/decision-reports/schema";

const STATUS_LABELS: Record<ClaimStatus, string> = {
  sourced: "From your brief",
  inferred: "AI inference",
  suggested: "AI suggestion",
  missing: "Needs your input",
  user_confirmed: "Confirmed by you",
};

const STATUS_STYLES: Record<ClaimStatus, string> = {
  sourced: "border-emerald-200 bg-emerald-50 text-emerald-800",
  inferred: "border-blue-200 bg-blue-50 text-blue-800",
  suggested: "border-violet-200 bg-violet-50 text-violet-800",
  missing: "border-amber-200 bg-amber-50 text-amber-800",
  user_confirmed: "border-teal-200 bg-teal-50 text-teal-800",
};

export function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function ClaimEditor({
  claim,
  label,
  placeholder,
  rows = 2,
  onChange,
}: {
  claim: Claim;
  label: string;
  placeholder?: string;
  rows?: number;
  onChange: (text: string) => void;
}) {
  const inputId = `claim-${claim.id}`;
  const missing = claim.status === "missing";

  return (
    <div
      className={`rounded-lg border px-3 py-2 transition-colors ${
        missing
          ? "border-dashed border-amber-300 bg-amber-50/40"
          : "border-[var(--border)] bg-[var(--surface)]"
      }`}
    >
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <label className="text-[12px] font-semibold text-[var(--text)]" htmlFor={inputId}>
          {label}
        </label>
        <ClaimStatusBadge status={claim.status} />
      </div>
      <textarea
        id={inputId}
        className="w-full resize-y bg-transparent text-[13px] leading-5 text-[var(--text)] outline-none placeholder:text-[var(--text-subtle)]"
        value={claim.text}
        rows={rows}
        placeholder={placeholder ?? (missing ? "Add what you know…" : undefined)}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function ClaimListEditor({
  claims,
  label,
  placeholder,
  onChange,
}: {
  claims: Claim[];
  label: string;
  placeholder?: string;
  onChange: (claimId: string, text: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">
        {label}
      </p>
      {claims.map((claim) => (
        <ClaimEditor
          key={claim.id}
          claim={claim}
          label={claim.status === "missing" ? "Missing information" : "Claim"}
          placeholder={placeholder}
          rows={2}
          onChange={(text) => onChange(claim.id, text)}
        />
      ))}
    </div>
  );
}

export function ProvenanceLegend() {
  const statuses: ClaimStatus[] = [
    "sourced",
    "inferred",
    "suggested",
    "missing",
    "user_confirmed",
  ];

  return (
    <div className="flex flex-wrap gap-2" aria-label="Claim provenance legend">
      {statuses.map((status) => (
        <ClaimStatusBadge key={status} status={status} />
      ))}
    </div>
  );
}
