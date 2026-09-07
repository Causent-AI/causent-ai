export type MetricUnit = "count" | "percent" | "USD";
export type NumericScale = "native" | "ratio" | "points";
export type BeneficialDirection = "higher" | "lower" | "neutral";
export type MetricAggregation = "sum" | "mean" | "rate" | "snapshot";

export type MetricDefinitionInput = {
  numericScale: NumericScale;
  beneficialDirection: BeneficialDirection;
  aggregation: MetricAggregation;
  denominator: string;
};

/** Stored magnitude and metric names cannot establish measurement semantics. */
export function parseMetricDefinition(value: unknown, unit: MetricUnit): MetricDefinitionInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  const { numericScale, beneficialDirection, aggregation, denominator } = fields;
  if (numericScale !== "native" && numericScale !== "ratio" && numericScale !== "points") return null;
  if (unit === "percent" ? numericScale !== "ratio" && numericScale !== "points" : numericScale !== "native") return null;
  if (beneficialDirection !== "higher" && beneficialDirection !== "lower" && beneficialDirection !== "neutral") return null;
  if (aggregation !== "sum" && aggregation !== "mean" && aggregation !== "rate" && aggregation !== "snapshot") return null;
  if (typeof denominator !== "string" || !denominator.trim() || denominator.length > 500) return null;
  return { numericScale, beneficialDirection, aggregation, denominator: denominator.trim() };
}
