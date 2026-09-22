// getActions() — shipped actions (merged GitHub PRs) with their per-metric honest
// impact cells, mapped from Supabase to lib/types.ts Action. Mirrors lib/seed.ts
// `actions`. Impact cells come from the materialized causal_edges/evidence via
// lib/data/graph.ts + lib/data/readout.ts — never hand-authored.

import type { Action, ImpactCell } from "@/lib/types";
import { getServerSupabase } from "@/lib/supabase-server";
import { collectKeyset } from "./keyset.ts";
import { METRIC_CONFIG_BY_NAME } from "@/lib/data/config";
import { getMetricRecords } from "@/lib/data/metrics";
import { edgeKey, loadEdgeReadouts } from "@/lib/data/graph";
import { toImpactCell } from "@/lib/data/readout";
import { safeActionSourceUrl } from "./action-source-url.ts";
import { toActionIdentity } from "@/lib/data/action-identifiers";
import { metricUiIdForExpectedName } from "@/lib/data/action-metric";
import { loadCurrentDecisionReportActivationContract } from "@/lib/data/decision-report-activation-contract";

type ActionRow = {
  action_id: string;
  source: string | null;
  external_ref: string | null;
  ship_ts: string | null;
  effective_date: string | null;
  status: string | null;
  rationale_richtext: RationaleDoc | null;
};

/** TipTap-ish doc stored in actions.rationale_richtext (see seed_demo.py _rationale). */
type RationaleDoc = {
  type?: string;
  title?: string;
  content?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  meta?: {
    source_url?: string;
    expected_metric?: string;
    source_item_id?: string;
    owner_label?: string;
    manual_completion?: { completed_on?: string; explanation?: string };
  };
};

/** Flatten a rationale doc's paragraphs into plain-text lines. */
function paragraphs(doc: RationaleDoc | null): string[] {
  if (!doc?.content) return [];
  const out: string[] = [];
  for (const block of doc.content) {
    if (block.type !== "paragraph" || !block.content) continue;
    const text = block.content
      .map((n) => (n.type === "text" ? n.text ?? "" : ""))
      .join("")
      .trim();
    if (text) out.push(text);
  }
  return out;
}

/**
 * All actions in the demo scope, newest ship date first (matches lib/seed.ts order),
 * each carrying an ImpactCell for every metric (canonical metric order). A cell shows
 * a number only where the engine made a confident causal claim; everything else is a
 * neutral "—" ("gathering data" / inconclusive).
 */
export async function getActions(scopeId: string): Promise<Action[]> {
  const sb = await getServerSupabase();

  const [actionsRes, records, edges, activationContract] = await Promise.all([
    collectKeyset<ActionRow>((after, size) => {
      let query = sb.from("actions")
        .select("action_id, source, external_ref, ship_ts, effective_date, status, rationale_richtext")
        .eq("scope_id", scopeId).order("action_id").limit(size);
      if (after) query = query.gt("action_id", after);
      return query;
    }, (row) => row.action_id),
    getMetricRecords(scopeId),
    loadEdgeReadouts(scopeId),
    loadCurrentDecisionReportActivationContract(scopeId),
  ]);
  const actionRows = actionsRes.rows.sort((a, b) =>
    (b.effective_date ?? "9999").localeCompare(a.effective_date ?? "9999") || a.action_id.localeCompare(b.action_id));

  const firstMetricSlug = records[0]?.metric.id ?? "arr";
  const metricUiIdByDbId = new Map(
    records.map((record) => [record.metricId, record.metric.id]),
  );
  const bindingByActionId = new Map(
    (activationContract?.actionBindings ?? []).map((binding) => [binding.actionId, binding]),
  );

  return actionRows.map((row) => {
    const identity = toActionIdentity(row);
    const doc = row.rationale_richtext;
    const body = paragraphs(doc);

    // Impact cells in canonical metric order; look up this action's edge per metric.
    const reportBinding = bindingByActionId.get(row.action_id) ?? null;
    const reportCreated = doc?.meta?.source_item_id !== undefined;
    const causalTargetActionId = activationContract?.registeredPrimaryActionId ?? null;
    const impact: ImpactCell[] = records.map((rec) => {
      const edge = edges.get(edgeKey(row.action_id, rec.metricId));
      if (
        reportCreated &&
        (
          !activationContract ||
          !reportBinding ||
          row.action_id !== causalTargetActionId ||
          rec.metricId !== activationContract.primaryMetricId
        )
      ) {
        // Normalized report bindings are authoritative. Historical or support
        // action edges cannot leak through as individual causal attribution.
        return toImpactCell(rec.metric, undefined);
      }
      return toImpactCell(rec.metric, edge);
    });

    // Primary metric = the action's hypothesized target (rationale meta). Join
    // report-created names to their generated UI ids before the legacy slug
    // fallback so every current-report action can find the displayed metric.
    const expectedName = doc?.meta?.expected_metric;
    const primaryMetricId = reportCreated
      ? reportBinding
        ? metricUiIdByDbId.get(reportBinding.metricId) ?? "metric-unavailable"
        : "metric-unavailable"
      : expectedName
        ? (
          metricUiIdForExpectedName(
            records.map((record) => record.metric),
            expectedName,
          ) ?? METRIC_CONFIG_BY_NAME[expectedName]?.id ?? expectedName
        )
        : firstMetricSlug;

    const action: Action = {
      id: identity.uiId,
      pr: identity.pr,
      source: identity.source,
      referenceLabel: identity.referenceLabel,
      sourceUrl: safeActionSourceUrl(doc?.meta?.source_url),
      sourceItemId: doc?.meta?.source_item_id,
      ownerLabel: doc?.meta?.owner_label,
      title: doc?.title ?? row.external_ref ?? identity.referenceLabel,
      shippedAt: row.effective_date ?? (row.ship_ts ? row.ship_ts.slice(0, 10) : null),
      primaryMetricId,
      impact,
    };

    if (activationContract && reportBinding) {
      action.reportContext = {
        activationId: activationContract.activationId,
        role: row.action_id === activationContract.registeredPrimaryActionId
          ? "registered-primary"
          : "supporting",
        causalObject: activationContract.causalObject,
        isPackageIntervention: row.action_id === activationContract.interventionActionId,
        packageCompletedAt: activationContract.packageCompletedAt,
        monitoringExpectedDirection: reportBinding.monitoringExpectedDirection,
        monitoringCheckDate: reportBinding.monitoringCheckDate,
      };
    }

    if (body.length > 0) {
      action.rationale = {
        hypothesis: body[0],
        expectedMetricId: primaryMetricId,
        body,
      };
    }
    const completion = doc?.meta?.manual_completion;
    if (completion?.completed_on && completion.explanation) {
      action.manualCompletion = {
        completedOn: completion.completed_on,
        explanation: completion.explanation,
      };
    }
    return action;
  });
}
