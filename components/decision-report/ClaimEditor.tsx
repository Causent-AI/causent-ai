import { RichTextClaimEditor } from "@/components/decision-report/rich-text/RichTextClaimEditor";
import {
  portableRichTextFromPlainText,
  type Claim,
  type ClaimStatus,
  type PortableRichTextDocument,
} from "@/lib/decision-reports/schema";

const STATUS_LABELS: Record<ClaimStatus, string> = {
  sourced: "From supplied source",
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
  optional = false,
  readOnly = false,
  variant = "field",
  richTextDocument,
  onDocumentChange,
  onChange,
}: {
  claim: Claim;
  label: string;
  placeholder?: string;
  rows?: number;
  optional?: boolean;
  readOnly?: boolean;
  variant?: "field" | "document" | "decision";
  richTextDocument?: PortableRichTextDocument;
  onDocumentChange?: (document: PortableRichTextDocument) => void;
  onChange: (text: string) => void;
}) {
  const inputId = `claim-${claim.id}`;
  const missing = claim.status === "missing";

  return (
    <div
      className={
        variant === "decision"
          ? `rounded-xl border px-4 py-4 ${
              missing && !optional
                ? "border-amber-300 bg-amber-50/60"
                : "border-blue-200 bg-blue-50/60"
            }`
          : variant === "document"
            ? `group rounded-lg border-l-2 px-3 py-3 transition-colors ${
                missing && !optional
                  ? "border-l-amber-400 bg-amber-50/60"
                  : "border-l-transparent hover:bg-slate-50/80 focus-within:border-l-[var(--brand-blue)] focus-within:bg-blue-50/35"
              }`
            : `rounded-lg border px-3 py-2 transition-colors ${
                missing && !optional
                  ? "border-dashed border-amber-300 bg-amber-50/40"
                  : missing
                    ? "border-dashed border-slate-300 bg-slate-50/60"
                    : "border-[var(--border)] bg-[var(--surface)]"
              }`
      }
    >
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <label
          className={
            variant === "document"
              ? "text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)] group-focus-within:text-[var(--brand-blue)]"
              : "text-[12px] font-semibold text-[var(--text)]"
          }
          htmlFor={inputId}
        >
          {label}
        </label>
        {missing && optional ? null : <ClaimStatusBadge status={claim.status} />}
      </div>
      {variant === "document" ? (
        <RichTextClaimEditor
          claimId={claim.id}
          label={label}
          document={
            richTextDocument ?? portableRichTextFromPlainText(claim.text)
          }
          placeholder={placeholder ?? (missing ? "Add what you know…" : undefined)}
          readOnly={readOnly}
          invalid={missing && !optional}
          onChange={(document) => onDocumentChange?.(document)}
        />
      ) : (
        <textarea
          id={inputId}
          className={`w-full resize-y bg-transparent text-[var(--text)] outline-none placeholder:text-[var(--text-subtle)] ${
            variant === "decision"
              ? "text-[15px] font-semibold leading-7"
              : "text-[13px] leading-5"
          }`}
          value={claim.text}
          rows={rows}
          placeholder={placeholder ?? (missing ? "Add what you know…" : undefined)}
          disabled={readOnly}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}

export function ClaimListEditor({
  claims,
  label,
  placeholder,
  optional = false,
  readOnly = false,
  variant = "field",
  claimDocuments,
  onDocumentChange,
  onChange,
}: {
  claims: Claim[];
  label: string;
  placeholder?: string;
  optional?: boolean;
  readOnly?: boolean;
  variant?: "field" | "document";
  claimDocuments?: Record<string, PortableRichTextDocument>;
  onDocumentChange?: (
    claimId: string,
    document: PortableRichTextDocument,
  ) => void;
  onChange: (claimId: string, text: string) => void;
}) {
  return (
    <div className={variant === "document" ? "flex flex-col" : "flex flex-col gap-2"}>
      {variant === "document" ? null : (
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">
          {label}
        </p>
      )}
      {claims.map((claim, index) => (
        <ClaimEditor
          key={claim.id}
          claim={claim}
          label={
            claim.status === "missing" && !optional
              ? "Missing information"
              : claims.length > 1
                ? `${label} ${index + 1}`
                : label
          }
          placeholder={placeholder}
          rows={2}
          optional={optional}
          readOnly={readOnly}
          variant={variant}
          richTextDocument={claimDocuments?.[claim.id]}
          onDocumentChange={(document) =>
            onDocumentChange?.(claim.id, document)
          }
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
