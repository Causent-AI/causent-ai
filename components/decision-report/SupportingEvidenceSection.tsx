import {
  ClaimEditor,
  ClaimListEditor,
} from "@/components/decision-report/ClaimEditor";
import { ReportSection } from "@/components/decision-report/ReportSection";
import { SuppliedMockup } from "@/components/decision-report/SuppliedMockup";
import type { ReportAssetView } from "@/lib/decision-reports/assets";
import type {
  DecisionReportV1,
  PortableRichTextDocument,
} from "@/lib/decision-reports/schema";

export function SupportingEvidenceSection({
  evidence,
  claimDocuments,
  asset,
  assetPending,
  assetDisabled,
  assetError,
  readOnly = false,
  onClaimChange,
  onClaimDocumentChange,
  onClaimAdd,
  onClaimDocumentAdd,
  onAssetUpload,
  onAssetRemove,
}: {
  evidence: DecisionReportV1["supportingEvidence"];
  claimDocuments?: Record<string, PortableRichTextDocument>;
  asset: ReportAssetView | null;
  assetPending: boolean;
  assetDisabled: boolean;
  assetError: string | null;
  readOnly?: boolean;
  onClaimChange: (claimId: string, text: string) => void;
  onClaimDocumentChange: (
    claimId: string,
    document: PortableRichTextDocument,
  ) => void;
  onClaimAdd: (text: string) => void;
  onClaimDocumentAdd: (document: PortableRichTextDocument) => void;
  onAssetUpload: (file: File) => void;
  onAssetRemove: () => void;
}) {
  return (
    <ReportSection
      number="2"
      title="Supporting Evidence"
      description="Add what supports the decision now, or return to it later."
    >
      <div
        className="rounded-xl border border-[var(--border)] bg-white p-2 shadow-sm shadow-slate-100 transition-shadow focus-within:border-blue-200 focus-within:shadow-md focus-within:shadow-blue-100/50"
        aria-label="Supporting evidence document section"
      >
        {evidence.factors.length === 0 ? (
          <ClaimEditor
            claim={{
              id: "new-supporting-evidence",
              text: "",
              status: "missing",
              sourceChunkIds: [],
            }}
            label="Supporting evidence"
            placeholder="Add what supports this decision…"
            optional
            variant="document"
            readOnly={readOnly}
            onDocumentChange={onClaimDocumentAdd}
            onChange={onClaimAdd}
          />
        ) : (
          <ClaimListEditor
            claims={evidence.factors}
            label="Supporting evidence"
            optional
            variant="document"
            readOnly={readOnly}
            claimDocuments={claimDocuments}
            onDocumentChange={onClaimDocumentChange}
            onChange={onClaimChange}
          />
        )}
        {!readOnly && evidence.factors.length > 0 && evidence.factors.length < 3 ? (
          <button
            type="button"
            className="my-2 text-[11px] font-semibold text-[var(--brand-teal)] hover:underline"
            onClick={() => onClaimAdd("")}
          >
            Add evidence
          </button>
        ) : null}
      </div>
      <SuppliedMockup
        asset={asset}
        readOnly={readOnly}
        disabled={assetDisabled}
        pending={assetPending}
        error={assetError}
        onUpload={onAssetUpload}
        onRemove={onAssetRemove}
      />
    </ReportSection>
  );
}
