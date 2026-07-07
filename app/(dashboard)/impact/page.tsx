import { loadDashboardData } from "@/lib/data/dashboard";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { AggregatedImpact } from "@/components/impact/AggregatedImpact";
import { ActionsTable } from "@/components/impact/ActionsTable";
import { TrustCaveat } from "@/components/impact/TrustCaveat";
import { ImpactBar } from "@/components/charts/ImpactBar";

export default async function ImpactPage() {
  const { actions, aggregatedImpact, impactByMetric, metrics } =
    await loadDashboardData();

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
          <ImpactBar rows={impactByMetric} metrics={metrics} />
        </Panel>

        <Panel>
          <PanelHeader title="Actions" />
          <ActionsTable actions={actions} metrics={metrics} />
        </Panel>
      </div>
    </div>
  );
}
