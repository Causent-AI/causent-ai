"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import type { Metric } from "@/lib/types";
type ReportLink = { id: string; title: string; status: string };
const ReportsContext = createContext<ReportLink[]>([]);
export function useWorkspaceReports() {
  return useContext(ReportsContext);
}
const Context = createContext<Metric[]>([]);
const InspectionContext = createContext<{
  metric: Metric | null;
  inspect: (metric: Metric | null) => void;
}>({ metric: null, inspect: () => {} });
export function WorkspaceMetricsProvider({
  metrics,
  reports = [],
  children,
}: {
  metrics: Metric[];
  reports?: ReportLink[];
  children: ReactNode;
}) {
  const [metric, inspect] = useState<Metric | null>(null);
  return (
    <ReportsContext.Provider value={reports}>
      <Context.Provider value={metrics}>
        <InspectionContext.Provider value={{ metric, inspect }}>
          {children}
        </InspectionContext.Provider>
      </Context.Provider>
    </ReportsContext.Provider>
  );
}
export function useMetricInspection() {
  return useContext(InspectionContext);
}
export function useWorkspaceMetrics() {
  return useContext(Context);
}
