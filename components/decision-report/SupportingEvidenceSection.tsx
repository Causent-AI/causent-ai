import {
  ClaimEditor,
  ClaimListEditor,
} from "@/components/decision-report/ClaimEditor";
import { MetricPredictionChart } from "@/components/decision-report/MetricPredictionChart";
import { ReportSection } from "@/components/decision-report/ReportSection";
import type {
  DecisionReportV1,
  MetricProjection,
} from "@/lib/decision-reports/schema";

export function SupportingEvidenceSection({
  evidence,
  projection,
  readOnly = false,
  onClaimChange,
}: {
  evidence: DecisionReportV1["supportingEvidence"];
  projection: MetricProjection;
  readOnly?: boolean;
  onClaimChange: (claimId: string, text: string) => void;
}) {
  return (
    <ReportSection
      number="2"
      title="Supporting Evidence"
      description="Up to three proof points and the proposed connection to the core metric."
    >
      <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
        <ClaimListEditor
          claims={evidence.factors}
          label="Factors and supplied evidence"
          readOnly={readOnly}
          onChange={onClaimChange}
        />
        <MetricPredictionChart projection={projection} />
      </div>

      <ClaimEditor
        claim={evidence.metricMechanism[0]}
        label="Why this should affect the core metric"
        readOnly={readOnly}
        onChange={(text) => onClaimChange(evidence.metricMechanism[0].id, text)}
      />
    </ReportSection>
  );
}
