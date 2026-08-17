import type {
  DriftReadout,
  DriftRefreshMetadata,
  DriftRefreshStatus,
  DriftStatus,
} from "@/lib/types";

export type DriftSnapshot = {
  byPrediction: Map<string, DriftReadout>;
  freshnessByPrediction: Map<string, DriftRefreshMetadata>;
};

const MAX_ROWS = 500;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const REFRESH_STATUSES = [
  "current",
  "queued",
  "processing",
  "retrying",
  "failed",
  "missing",
] as const;
const DETECTOR_STATUSES = ["FIRED", "NOT_FIRED", "NO_BASELINE_YET"] as const;
const DIRECTIONS = ["up", "down"] as const;

type DriftRpcRow = {
  prediction_id: unknown;
  refresh_status: unknown;
  detector_status: unknown;
  reason: unknown;
  shift_date: unknown;
  pre_level: unknown;
  post_level: unknown;
  delta_native: unknown;
  pct_change: unknown;
  direction: unknown;
  ci_low: unknown;
  ci_high: unknown;
  n_pre: unknown;
  n_post: unknown;
  requested_generation: unknown;
  processed_generation: unknown;
  requested_at: unknown;
  computed_at: unknown;
  last_processed_at: unknown;
  next_attempt_at: unknown;
};

export function emptyDriftSnapshot(): DriftSnapshot {
  return {
    byPrediction: new Map(),
    freshnessByPrediction: new Map(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
  );
}

function isIsoTimestampOrNull(value: unknown): value is string | null {
  return value === null || (
    typeof value === "string" && Number.isFinite(Date.parse(value))
  );
}

function isIsoDateOrNull(value: unknown): value is string | null {
  return value === null || (
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)
  );
}

function includes<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value as T[number]);
}

/** Any malformed row fails the complete workspace snapshot closed rather than
 * mixing trusted and untrusted statistical claims. */
export function parseDriftSnapshot(value: unknown): DriftSnapshot {
  if (!Array.isArray(value) || value.length > MAX_ROWS) return emptyDriftSnapshot();

  const byPrediction = new Map<string, DriftReadout>();
  const freshnessByPrediction = new Map<string, DriftRefreshMetadata>();
  for (const raw of value) {
    if (!isRecord(raw)) return emptyDriftSnapshot();
    const row = raw as DriftRpcRow;
    if (
      typeof row.prediction_id !== "string" ||
      !UUID_PATTERN.test(row.prediction_id) ||
      freshnessByPrediction.has(row.prediction_id) ||
      !includes(REFRESH_STATUSES, row.refresh_status) ||
      !isNullableNonNegativeInteger(row.requested_generation) ||
      !isNullableNonNegativeInteger(row.processed_generation) ||
      !isIsoTimestampOrNull(row.requested_at) ||
      !isIsoTimestampOrNull(row.computed_at) ||
      !isIsoTimestampOrNull(row.last_processed_at) ||
      !isIsoTimestampOrNull(row.next_attempt_at)
    ) {
      return emptyDriftSnapshot();
    }

    const refreshStatus = row.refresh_status as DriftRefreshStatus;
    const detectorFields = [
      row.detector_status,
      row.reason,
      row.shift_date,
      row.pre_level,
      row.post_level,
      row.delta_native,
      row.pct_change,
      row.direction,
      row.ci_low,
      row.ci_high,
      row.n_pre,
      row.n_post,
    ];
    const currentGenerationIsCoherent =
      row.requested_generation !== null &&
      row.requested_generation > 0 &&
      row.requested_generation === row.processed_generation &&
      row.requested_at !== null &&
      row.computed_at !== null &&
      row.last_processed_at !== null &&
      row.next_attempt_at === null;
    freshnessByPrediction.set(row.prediction_id, {
      status: refreshStatus,
      requestedGeneration: row.requested_generation,
      processedGeneration: row.processed_generation,
      requestedAt: row.requested_at,
      computedAt: row.computed_at,
      lastProcessedAt: row.last_processed_at,
      nextAttemptAt: row.next_attempt_at,
    });

    if (refreshStatus !== "current") {
      if (detectorFields.some((field) => field !== null)) return emptyDriftSnapshot();
      continue;
    }

    if (
      !currentGenerationIsCoherent ||
      !includes(DETECTOR_STATUSES, row.detector_status) ||
      !isNullableString(row.reason) ||
      !isIsoDateOrNull(row.shift_date) ||
      !isNullableFiniteNumber(row.pre_level) ||
      !isNullableFiniteNumber(row.post_level) ||
      !isNullableFiniteNumber(row.delta_native) ||
      !isNullableFiniteNumber(row.pct_change) ||
      !(row.direction === null || includes(DIRECTIONS, row.direction)) ||
      !isNullableFiniteNumber(row.ci_low) ||
      !isNullableFiniteNumber(row.ci_high) ||
      !isNullableNonNegativeInteger(row.n_pre) ||
      !isNullableNonNegativeInteger(row.n_post) ||
      row.n_pre === null ||
      row.n_post === null
    ) {
      return emptyDriftSnapshot();
    }

    byPrediction.set(row.prediction_id, {
      status: row.detector_status as DriftStatus,
      reason: row.reason,
      shiftDate: row.shift_date,
      preLevel: row.pre_level,
      postLevel: row.post_level,
      deltaNative: row.delta_native,
      pctChange: row.pct_change,
      direction: row.direction as "up" | "down" | null,
      ciLow: row.ci_low,
      ciHigh: row.ci_high,
      nPre: row.n_pre,
      nPost: row.n_post,
    });
  }

  return { byPrediction, freshnessByPrediction };
}
