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
  onClaimChange,
}: {
  evidence: DecisionReportV1["supportingEvidence"];
  projection: MetricProjection;
  onClaimChange: (claimId: string, text: string) => void;
}) {
  return (
    <ReportSection
      number="2"
      title="Supporting Evidence"
      description="What supports the decision, how it should move the metric, and what else could be done."
    >
      <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
        <ClaimListEditor
          claims={evidence.factors}
          label="Factors and supplied evidence"
          onChange={onClaimChange}
        />
        <MetricPredictionChart projection={projection} />
      </div>

      <ClaimEditor
        claim={evidence.metricMechanism[0]}
        label="Why this should affect the core metric"
        onChange={(text) => onClaimChange(evidence.metricMechanism[0].id, text)}
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <ClaimListEditor
          claims={evidence.alternatives}
          label="Alternatives considered"
          onChange={onClaimChange}
        />
        <ClaimListEditor
          claims={evidence.precedent}
          label="Relevant precedent"
          placeholder="Add a prior decision or leave visibly missing."
          onChange={onClaimChange}
        />
      </div>
    </ReportSection>
  );
}
