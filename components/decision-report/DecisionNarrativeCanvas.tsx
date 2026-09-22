"use client";

import { DocumentSectionTitle } from "./DocumentLayout";
import { SuppliedMockup } from "@/components/decision-report/SuppliedMockup";
import {
  ReportCanvasEditor,
  type ReportCanvasDocumentChange,
  type ReportCanvasSection,
} from "@/components/decision-report/rich-text/ReportCanvasEditor";
import type { ReportAssetView } from "@/lib/decision-reports/assets";
import {
  flattenPortableRichText,
  getClaimPortableRichTextDocument,
  portableRichTextFromPlainText,
  type DecisionReportV1,
  type PortableRichTextDocument,
} from "@/lib/decision-reports/schema";

const EMPTY_EVIDENCE_ID = "new-supporting-evidence";

function requiredClaimInvalid(text: string): boolean {
  return text.trim() === "";
}

export function DecisionNarrativeCanvas({
  report,
  asset,
  assetPending,
  assetDisabled,
  assetError,
  readOnly,
  onDocumentsChange,
  onEvidenceAdd,
  onEvidenceDocumentAdd,
  onEvidenceRemove,
  onAssetUpload,
  onAssetRemove,
}: {
  report: DecisionReportV1;
  asset: ReportAssetView | null;
  assetPending: boolean;
  assetDisabled: boolean;
  assetError: string | null;
  readOnly: boolean;
  onDocumentsChange: (changes: ReportCanvasDocumentChange[]) => void;
  onEvidenceAdd: (text: string) => void;
  onEvidenceDocumentAdd: (document: PortableRichTextDocument) => void;
  onEvidenceRemove: (claimId: string) => void;
  onAssetUpload: (file: File) => void;
  onAssetRemove: () => void;
}) {
  const background = report.decision.background[0];
  const problem = report.decision.problem[0];
  const decision = report.decision.decision[0];
  const evidence = report.supportingEvidence.factors;
  const sections: ReportCanvasSection[] = [
    {
      claimId: background.id,
      label: "Background",
      document: getClaimPortableRichTextDocument(report, background),
      invalid: requiredClaimInvalid(background.text),
    },
    {
      claimId: problem.id,
      label: "Problem",
      document: getClaimPortableRichTextDocument(report, problem),
      invalid: requiredClaimInvalid(problem.text),
    },
    {
      claimId: decision.id,
      label: "Decision",
      document: getClaimPortableRichTextDocument(report, decision),
      invalid: requiredClaimInvalid(decision.text),
    },
    ...(evidence.length === 0
      ? [{
          claimId: EMPTY_EVIDENCE_ID,
          label: "Evidence (optional)",
          document: portableRichTextFromPlainText(""),
        }]
      : evidence.map((claim, index) => ({
          claimId: claim.id,
          label: index === 0 ? "Evidence (optional)" : `Evidence ${index + 1} (optional)`,
          document: getClaimPortableRichTextDocument(report, claim),
        }))),
  ];

  function updateCanvas(changes: ReportCanvasDocumentChange[]) {
    const virtualEvidence = changes.find(
      (change) => change.claimId === EMPTY_EVIDENCE_ID,
    );
    const persisted = changes.filter(
      (change) => change.claimId !== EMPTY_EVIDENCE_ID,
    );
    if (persisted.length > 0) onDocumentsChange(persisted);
    if (
      virtualEvidence &&
      flattenPortableRichText(virtualEvidence.document).trim() !== ""
    ) {
      onEvidenceDocumentAdd(virtualEvidence.document);
    }
  }

  return (
    <>
    <section id="report-overview" className="document-section">
      <DocumentSectionTitle section="overview"/>
      <ReportCanvasEditor canvasId="report-overview-editor" label="Overview" sections={sections.slice(0, 2)} readOnly={readOnly} onChange={updateCanvas}/>
    </section>
    <section id="report-decision" className="document-section">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <DocumentSectionTitle section="decision"/>
        </div>
        {!readOnly && evidence.length > 0 && evidence.length < 3 ? (
          <button
            type="button"
            className="min-h-11 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-[11px] font-semibold text-[var(--text)]"
            onClick={() => onEvidenceAdd("")}
          >
            Add evidence
          </button>
        ) : null}
      </div>

      <ReportCanvasEditor
        canvasId="decision-narrative-editor"
        label="Decision narrative"
        sections={sections.slice(2)}
        readOnly={readOnly}
        onChange={updateCanvas}
      />

      {evidence.length > 0 && !readOnly ? (
        <div className="mt-2 flex flex-wrap justify-end gap-3">
          {evidence.map((claim, index) => (
            <button
              key={claim.id}
              type="button"
              className="min-h-11 rounded-lg px-2 text-[10px] font-semibold text-red-700 underline-offset-2 hover:bg-red-50 hover:underline"
              onClick={() => onEvidenceRemove(claim.id)}
            >
              Remove evidence {index + 1}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-6">
        <SuppliedMockup
          asset={asset}
          readOnly={readOnly}
          disabled={assetDisabled}
          pending={assetPending}
          error={assetError}
          onUpload={onAssetUpload}
          onRemove={onAssetRemove}
        />
      </div>
    </section></>
  );
}
