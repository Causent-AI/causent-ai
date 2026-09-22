"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { Metric } from "@/lib/types";
const Context = createContext<Metric[]>([]);
export function WorkspaceMetricsProvider({
  metrics,
  children,
}: {
  metrics: Metric[];
  children: ReactNode;
}) {
  return <Context.Provider value={metrics}>{children}</Context.Provider>;
}
export function useWorkspaceMetrics() {
  return useContext(Context);
}
