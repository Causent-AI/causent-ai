// getObjective() — the workspace's north-star document, mapped from the
// `objectives` row to lib/types.ts ProjectObjective. Mirrors the lib/seed.ts
// `projectObjective` export. Returns null when the workspace has no objective
// yet (the ObjectivePanel simply doesn't render).

import type { ProjectObjective } from "@/lib/types";
import { getServerSupabase } from "@/lib/supabase-server";

type ObjectiveRow = {
  title: string;
  statement: string;
  key_results: unknown;
  updated_at: string;
};

/** The demo scope's north-star objective, or null if none is set. */
export async function getObjective(scopeId: string): Promise<ProjectObjective | null> {
  const sb = await getServerSupabase();
  const res = await sb
    .from("objectives")
    .select("title, statement, key_results, updated_at")
    .eq("scope_id", scopeId)
    .maybeSingle();
  if (res.error) throw res.error;
  if (!res.data) return null;

  const row = res.data as ObjectiveRow;
  return {
    title: row.title,
    statement: row.statement,
    keyResults: Array.isArray(row.key_results)
      ? row.key_results.filter((r): r is string => typeof r === "string")
      : [],
    updatedAt: row.updated_at,
  };
}
