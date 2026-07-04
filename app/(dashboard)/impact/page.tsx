import {
  actions,
  aggregatedImpact,
  impactByMetric,
} from "@/lib/seed";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { AggregatedImpact } from "@/components/impact/AggregatedImpact";
import { ActionsTable } from "@/components/impact/ActionsTable";
import { TrustCaveat } from "@/components/impact/TrustCaveat";
import { ImpactBar } from "@/components/charts/ImpactBar";

export default function ImpactPage() {
  return (
    <div className="mx-auto max-w-[1360px] space-y-4 p-5">
      <AggregatedImpact stats={aggregatedImpact} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Impact by Metric"
            subtitle="Last 30 Days vs Prior 30 Days"
          />
          <div className="mb-4">
            <TrustCaveat />
          </div>
          <ImpactBar rows={impactByMetric} />
        </Panel>

        <Panel>
          <PanelHeader title="Actions" />
          <ActionsTable actions={actions} />
        </Panel>
      </div>
    </div>
  );
}
