import { ClaimEditor } from "@/components/decision-report/ClaimEditor";
import { ReportSection } from "@/components/decision-report/ReportSection";
import type {
  DecisionReportV1,
  PortableRichTextDocument,
} from "@/lib/decision-reports/schema";

export function DecisionSection({
  decision,
  claimDocuments,
  readOnly = false,
  onClaimChange,
  onClaimDocumentChange,
}: {
  decision: DecisionReportV1["decision"];
  claimDocuments?: Record<string, PortableRichTextDocument>;
  readOnly?: boolean;
  onClaimChange: (claimId: string, text: string) => void;
  onClaimDocumentChange: (
    claimId: string,
    document: PortableRichTextDocument,
  ) => void;
}) {
  return (
    <ReportSection
      number="1"
      title="Decision"
      description="Background, problem, and decision in one place."
    >
      <div
        className="rounded-xl border border-[var(--border)] bg-white p-2 shadow-sm shadow-slate-100 transition-shadow focus-within:border-blue-200 focus-within:shadow-md focus-within:shadow-blue-100/50"
        aria-label="Decision document section"
      >
        <ClaimEditor
          claim={decision.background[0]}
          label="Background"
          rows={3}
          variant="document"
          readOnly={readOnly}
          richTextDocument={claimDocuments?.[decision.background[0].id]}
          onDocumentChange={(document) =>
            onClaimDocumentChange(decision.background[0].id, document)
          }
          onChange={(text) => onClaimChange(decision.background[0].id, text)}
        />
        <ClaimEditor
          claim={decision.problem[0]}
          label="Problem"
          rows={3}
          variant="document"
          readOnly={readOnly}
          richTextDocument={claimDocuments?.[decision.problem[0].id]}
          onDocumentChange={(document) =>
            onClaimDocumentChange(decision.problem[0].id, document)
          }
          onChange={(text) => onClaimChange(decision.problem[0].id, text)}
        />
        <ClaimEditor
          claim={decision.decision[0]}
          label="Decision"
          rows={3}
          variant="document"
          readOnly={readOnly}
          richTextDocument={claimDocuments?.[decision.decision[0].id]}
          onDocumentChange={(document) =>
            onClaimDocumentChange(decision.decision[0].id, document)
          }
          onChange={(text) => onClaimChange(decision.decision[0].id, text)}
        />
      </div>
    </ReportSection>
  );
}
