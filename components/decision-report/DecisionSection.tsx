import { ClaimEditor } from "@/components/decision-report/ClaimEditor";
import { ReportSection } from "@/components/decision-report/ReportSection";
import type { DecisionReportV1 } from "@/lib/decision-reports/schema";

export function DecisionSection({
  decision,
  onClaimChange,
}: {
  decision: DecisionReportV1["decision"];
  onClaimChange: (claimId: string, text: string) => void;
}) {
  return (
    <ReportSection
      number="1"
      title="Decision"
      description="What will change, the necessary context, and the customer problem being solved."
    >
      <ClaimEditor
        claim={decision.decision[0]}
        label="Decision being made"
        rows={2}
        onChange={(text) => onClaimChange(decision.decision[0].id, text)}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <ClaimEditor
          claim={decision.background[0]}
          label="Background"
          rows={3}
          onChange={(text) => onClaimChange(decision.background[0].id, text)}
        />
        <ClaimEditor
          claim={decision.problem[0]}
          label="Problem"
          rows={3}
          onChange={(text) => onClaimChange(decision.problem[0].id, text)}
        />
      </div>
    </ReportSection>
  );
}
