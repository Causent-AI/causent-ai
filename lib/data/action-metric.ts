import type { Metric } from "../types.ts";

/**
 * Resolve rationale metadata to the UI identity of a metric already loaded for
 * the workspace. Report-created metrics use a generated UI id rather than a
 * legacy catalog slug, so their display name must be joined through the loaded
 * metric records before falling back to the legacy map.
 */
export function metricUiIdForExpectedName(
  metrics: Array<Pick<Metric, "id" | "name">>,
  expectedName: string | null | undefined,
): string | null {
  if (!expectedName) return null;
  return metrics.find((metric) => metric.name === expectedName)?.id ?? null;
}
