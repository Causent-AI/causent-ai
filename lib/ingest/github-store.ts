// Service-only backfill adapter. The database ignores only the canonical identity conflict.
import { getServiceRoleSupabase } from "@/lib/supabase-server";
import type { ActionRow, ActionStore } from "@/lib/ingest/github";

export function createSupabaseActionStore(): ActionStore {
  const sb = getServiceRoleSupabase();
  return {
    async existingRefs(scopeId: string, refs: string[]): Promise<Set<string>> {
      if (refs.length === 0) return new Set();
      const { data, error } = await sb
        .from("actions")
        .select("external_ref")
        .eq("scope_id", scopeId)
        .in("external_ref", refs);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ external_ref: string | null }>;
      return new Set(rows.map((r) => r.external_ref).filter((r): r is string => r != null));
    },

    async insert(rows: ActionRow[]): Promise<number> {
      if (rows.length === 0) return 0;
      const { data, error } = await sb.rpc("ingest_github_actions_v1", { p_rows: rows });
      if (error) throw error;
      const receipt = data?.[0];
      if (!receipt || receipt.rejected !== 0 || receipt.inserted + receipt.duplicates !== rows.length) {
        throw new Error("Invalid GitHub import receipt");
      }
      return receipt.inserted;
    },
  };
}
