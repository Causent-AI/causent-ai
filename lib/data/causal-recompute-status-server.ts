import "server-only";

import {
  loadCurrentCausalRecomputeStatus,
  type CausalRecomputeStatus,
} from "@/lib/data/causal-recompute-status";
import { getServerSupabase } from "@/lib/supabase-server";

export async function getCurrentCausalRecomputeStatus(scopeId: string): Promise<
  CausalRecomputeStatus | null
> {
  return loadCurrentCausalRecomputeStatus(await getServerSupabase(), scopeId);
}
