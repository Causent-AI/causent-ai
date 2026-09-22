// getPriorsForReferenceClass() — the RLS-scoped reference-class query behind
// the prediction-capture precedent panel (epic #6, child #9). The math lives
// in the PURE lib/priors.ts (unit-tested without a DB); this wrapper only
// fetches the terminally-resolved tuples and narrows the class.

import {
  computePriors,
  fromStoredTuple,
  type ReferenceClassPriors,
  type ResolutionTuple,
} from "@/lib/priors";
import { getServerSupabase } from "@/lib/supabase-server";
import { collectKeyset } from "./keyset";

/**
 * Priors for a reference class. The class is (metric) narrowed by mechanism
 * category when one is given; only TERMINALLY resolved predictions contribute
 * (GATHERING is a not-yet, not an outcome — resolved_at stays NULL).
 */
export async function getPriorsForReferenceClass(params: {
  scopeId: string;
  metricId: string;
  mechanismCategory?: string | null;
}): Promise<ReferenceClassPriors> {
  const sb = await getServerSupabase();
  type PriorRow = Parameters<typeof fromStoredTuple>[0] & { prediction_id: string };
  const { rows } = await collectKeyset<PriorRow>((after, size) => {
    let query = sb.from("predictions")
      .select("prediction_id, resolved_verdict, resolution_tuple")
      .eq("scope_id", params.scopeId).eq("metric_id", params.metricId)
      .not("resolved_at", "is", null).order("prediction_id").limit(size);
    if (after) query = query.gt("prediction_id", after);
    return query;
  }, (row) => row.prediction_id);

  let tuples = rows
    .map(fromStoredTuple)
    .filter((t): t is ResolutionTuple => t !== null);
  tuples = tuples.filter((t) => t.mechanismCategory === (params.mechanismCategory ?? null));
  return computePriors(tuples);
}
