import { Suspense } from "react";
import { loadDashboardData } from "@/lib/data/dashboard";
import { ActionsPageClient } from "@/components/actions/ActionsPageClient";

// Server page: reads actions + metrics from lib/data (Supabase, seed fallback) and
// hands them to the client child, which owns the click-to-select interactivity.
// Suspense boundary: the client child reads ?selected via useSearchParams, which
// requires one for static prerender.

export default async function ActionsPage() {
  const { actions, metrics, objective } = await loadDashboardData();
  return (
    <Suspense>
      <ActionsPageClient
        actions={actions}
        metrics={metrics}
        objective={objective}
      />
    </Suspense>
  );
}
