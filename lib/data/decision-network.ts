import type { Action, Decision, Metric } from "../types.ts";
import type { DashboardDecisionReport } from "./decision-reports.ts";
export type NetworkNode = {
  id: string;
  reportId: string | null;
  title: string;
  date: string;
  dateLabel: string;
  workspaceId: string;
  project: string;
  workspace: string;
  status: string;
  metricIds: string[];
  summary: string;
  predecessorId: string | null;
  impacts: Array<{ metricId: string; label: string; detail: string }>;
};
export function buildDecisionNetwork(input: {
  workspaceId: string;
  project: string;
  workspace: string;
  reports: DashboardDecisionReport[];
  decisions: Decision[];
  actions: Action[];
  metrics: Metric[];
  metricIds?: Record<string, string>;
}): NetworkNode[] {
  const metricKey = (id: string) =>
    `${input.workspaceId}:${input.metricIds?.[id] ?? id}`;
  const reportDecisions = new Set(input.reports.map((r) => r.decisionId));
  const nodes = input.reports.map((report): NetworkNode => {
    const decision = input.decisions.find((d) => d.id === report.decisionId);
    const metricIds = [
      ...new Set(
        [
          report.metricId,
          ...(report.report.activationDraft?.selectedMetricIds ?? []),
          report.report.activationDraft?.confirmedMetricId,
          ...report.report.implementation.actions.map((a) => a.metricId),
        ].filter((id): id is string => Boolean(id)),
      ),
    ];
    return {
      id: report.id,
      reportId: report.id,
      title: report.title,
      date: decision?.createdAt ?? report.updatedAt.slice(0, 10),
      dateLabel: decision ? "Decision created" : "Draft updated",
      workspaceId: input.workspaceId,
      project: input.project,
      workspace: input.workspace,
      status: report.isCurrent
        ? "Current"
        : report.status === "active"
          ? "Previous"
          : "Draft",
      metricIds: metricIds.map(metricKey),
      summary: report.report.decision.decision
        .map((c) => c.text)
        .filter(Boolean)
        .join("\n"),
      predecessorId: report.predecessorReportId,
      impacts: decision
        ? input.actions
            .filter((a) => decision.actionIds.includes(a.id))
            .flatMap((a) =>
              a.impact.map((impact) => ({
                metricId: metricKey(impact.metricId),
                label: `${a.title}: ${impact.label}`,
                detail:
                  impact.detail ??
                  (impact.value === null
                    ? "No measured impact"
                    : (impact.evidence ?? "Unverified")),
              })),
            )
        : [],
    };
  });
  for (const decision of input.decisions) {
    if (reportDecisions.has(decision.id)) continue;
    nodes.push({
      id: decision.id,
      reportId: null,
      title: decision.title,
      date: decision.createdAt,
      dateLabel: "Decision created",
      workspaceId: input.workspaceId,
      project: input.project,
      workspace: input.workspace,
      status: "Decision",
      metricIds: [
        ...new Set(decision.predictions.map((p) => metricKey(p.metricId))),
      ],
      summary: decision.rationale.body.join("\n"),
      predecessorId: null,
      impacts: input.actions
        .filter((a) => decision.actionIds.includes(a.id))
        .flatMap((a) =>
          a.impact.map((impact) => ({
            metricId: metricKey(impact.metricId),
            label: `${a.title}: ${impact.label}`,
            detail: impact.detail ?? "Measured action readout",
          })),
        ),
    });
  }
  return nodes.sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
}
