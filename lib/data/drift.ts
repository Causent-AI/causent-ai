// One bounded, workspace-scoped read of asynchronously materialized drift.
// Detector execution belongs to the Python worker; dashboard rendering only
// consumes current rows from the checked RPC and fails closed on stale,
// malformed, over-limit, or unavailable responses.

import "server-only";
import { cache } from "react";

import { getServerSupabase } from "@/lib/supabase-server";
import {
  emptyDriftSnapshot,
  parseDriftSnapshot,
  type DriftSnapshot,
} from "@/lib/data/drift-snapshot";

export type { DriftSnapshot } from "@/lib/data/drift-snapshot";

export const getCurrentDriftSnapshot = cache(async function getCurrentDriftSnapshot(
  scopeId: string,
): Promise<DriftSnapshot> {
  const sb = await getServerSupabase();
  const response = await sb.rpc("get_current_prediction_drift_v1", {
    p_scope_id: scopeId,
  });
  if (response.error) return emptyDriftSnapshot();
  return parseDriftSnapshot(response.data);
});
