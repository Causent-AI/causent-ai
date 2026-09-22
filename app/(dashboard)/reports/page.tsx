import { loadDashboardData } from "@/lib/data/dashboard";
import { ReportsPageClient } from "@/components/reports/ReportsPageClient";
import OnboardingPage from "@/app/(onboarding)/onboarding/page";
import Link from "next/link";
import { StartIterationControl, DeleteReportControl } from "@/components/reports/DecisionReportsIndex";
import { DecisionReportsIndex } from "@/components/reports/DecisionReportsIndex";

// Server page: reads the full dashboard payload (Supabase, seed fallback) and hands
// the saved reports + the project rollup data to the client, which owns the
// click-to-select interactivity and renders the report document.

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ report?: string; library?: string }> }) {
  const params = await searchParams;
  const {
    reports,
    scope,
    objective,
    aggregatedImpact,
    impactByMetric,
    metrics,
    actions,
    decisionReports,
    source,
  } = await loadDashboardData();

  if (source === "db") {
    if (params.library === "1" || decisionReports.length === 0) return <DecisionReportsIndex reports={decisionReports} />;
    const selected = decisionReports.find((report) => report.id === params.report) ?? (params.report ? null : decisionReports[0]);
    if (!selected) return <div className="workspace-page"><h1>Report unavailable</h1><Link href="/reports?library=1">Report library</Link></div>;
    return <>
      <div className="report-version-controls flex flex-wrap items-center justify-end gap-3 px-8 pt-5 text-xs">
        <span>Version {selected.iterationNumber} · {selected.isCurrent ? "Current" : selected.status === "active" ? "Previous" : "Draft"}</span>
        {selected.isCurrent && selected.status === "active" ? <StartIterationControl reportId={selected.id}/> : null}
        <DeleteReportControl reportId={selected.id} active={selected.status === "active"} current={selected.isCurrent} iterationNumber={selected.iterationNumber}/>
      </div>
      <OnboardingPage key={selected.id} searchParams={Promise.resolve({ report: selected.id })}/>
    </>;
  }

  return (
    <ReportsPageClient
      reports={reports}
      scope={scope}
      objective={objective}
      aggregatedImpact={aggregatedImpact}
      impactByMetric={impactByMetric}
      metrics={metrics}
      actions={actions}
    />
  );
}
