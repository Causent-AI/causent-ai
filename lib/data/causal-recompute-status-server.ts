import "server-only";

import { getSession } from "@/lib/auth/session";
import {
  loadCurrentCausalRecomputeStatus,
  type CausalRecomputeStatus,
} from "@/lib/data/causal-recompute-status";
import { getServerSupabase } from "@/lib/supabase-server";

export async function getCurrentCausalRecomputeStatus(): Promise<
  CausalRecomputeStatus | null
> {
  const [sb, session] = await Promise.all([getServerSupabase(), getSession()]);
  return loadCurrentCausalRecomputeStatus(sb, session.workspaceId);
}
