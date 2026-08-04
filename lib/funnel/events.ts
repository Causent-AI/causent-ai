// Funnel instrumentation — the pure core (C2/#15 DoD + C5/#18).
//
// The onboarding funnel and the resolution scorecard emit append-only
// `funnel_events` rows (see the migration + lib/data/funnel.ts). This module is
// the PURE, unit-tested half: it defines the event vocabulary and folds a set
// of rows into the metrics the DoD names —
//
//   - time-to-first-type   (target < 30s from landing to first keystroke)
//   - Step-4 commit rate    (committed funnel runs / landed funnel runs)
//   - step drop-off         (how many runs reached each step)
//   - resolution-return rate (#18: runs that came back to view a scorecard)
//
// No IO here — the row reader/writer lives in lib/data/funnel.ts so this stays
// trivially testable and the "no logic in the wiring" convention holds.

export const LEGACY_FUNNEL_EVENT_TYPES = [
  "LANDED",
  "STEP_VIEW",
  "FIRST_TYPE",
  "STRUCTURED",
  "COMMITTED",
  "SHIP_STATE",
  "SCORECARD_VIEW",
] as const;

export const DECISION_REPORT_FUNNEL_EVENT_TYPES = [
  "REPORT_LANDED",
  "REPORT_GENERATION_STARTED",
  "REPORT_EDITABLE",
  "REPORT_GENERATION_FAILED",
  "REPORT_SAVED",
  "REPORT_SAVE_FAILED",
  "REPORT_ACTIVATED",
  "REPORT_ACTIVATION_FAILED",
] as const;

export const FUNNEL_EVENT_TYPES = [
  ...LEGACY_FUNNEL_EVENT_TYPES,
  ...DECISION_REPORT_FUNNEL_EVENT_TYPES,
] as const;

export type LegacyFunnelEventType = (typeof LEGACY_FUNNEL_EVENT_TYPES)[number];
export type DecisionReportFunnelEventType =
  (typeof DECISION_REPORT_FUNNEL_EVENT_TYPES)[number];
export type FunnelEventType = (typeof FUNNEL_EVENT_TYPES)[number];

const LEGACY_FUNNEL_EVENT_TYPE_SET = new Set<string>(LEGACY_FUNNEL_EVENT_TYPES);
const DECISION_REPORT_FUNNEL_EVENT_TYPE_SET = new Set<string>(
  DECISION_REPORT_FUNNEL_EVENT_TYPES,
);

export function isLegacyFunnelEventType(value: unknown): value is LegacyFunnelEventType {
  return typeof value === "string" && LEGACY_FUNNEL_EVENT_TYPE_SET.has(value);
}

export function isDecisionReportFunnelEventType(
  value: unknown,
): value is DecisionReportFunnelEventType {
  return typeof value === "string" && DECISION_REPORT_FUNNEL_EVENT_TYPE_SET.has(value);
}

export const DECISION_REPORT_FUNNEL_META_KEYS = [
  "editCount",
  "followUpCount",
  "missingFieldCount",
  "usedUrl",
  "usedPdf",
  "usedFallback",
  "reused",
] as const;

export type DecisionReportFunnelMeta = Partial<{
  editCount: number;
  followUpCount: number;
  missingFieldCount: number;
  usedUrl: boolean;
  usedPdf: boolean;
  usedFallback: boolean;
  reused: boolean;
}>;

/** The four funnel steps, in order — the drop-off axis. */
export const FUNNEL_STEPS = ["paste", "card", "commit", "done"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

/** Time-to-first-type target from the #15 DoD. */
export const TIME_TO_FIRST_TYPE_TARGET_MS = 30_000;

export type FunnelEventRow = {
  sessionKey: string;
  eventType: FunnelEventType;
  step: string | null;
  msSinceStart: number | null;
  meta?: Record<string, unknown> | null;
};

export type FunnelMetrics = {
  /** Distinct funnel runs that emitted any event. */
  landedRuns: number;
  /** Runs that reached COMMITTED (Step-4 numerator). */
  committedRuns: number;
  /** committedRuns / landedRuns, or null when nothing landed. */
  commitRate: number | null;
  timeToFirstType: {
    /** How many runs recorded a first keystroke. */
    count: number;
    medianMs: number | null;
    /** Fraction of first-type samples under the 30s target, or null. */
    underTargetRate: number | null;
  };
  /** step -> distinct runs that viewed it (the drop-off curve). */
  dropOffByStep: Record<FunnelStep, number>;
  /** Runs that reached the ship-state screen (#18). */
  shipStateRuns: number;
  /** committed runs that later viewed a resolution scorecard / committed runs. */
  resolutionReturnRate: number | null;
};

export const DECISION_REPORT_FUNNEL_STAGES = [
  "landed",
  "generationStarted",
  "editable",
  "saved",
  "activated",
] as const;

export type DecisionReportFunnelStage =
  (typeof DECISION_REPORT_FUNNEL_STAGES)[number];

export type DecisionReportDropoff = {
  eligibleSessions: number;
  advancedSessions: number;
  droppedSessions: number;
  dropoffRate: number | null;
};

export type DecisionReportSampleSummary = {
  sampledSessions: number;
  median: number | null;
};

export type DecisionReportFailureCount = {
  events: number;
  sessions: number;
};

export type DecisionReportFunnelMetrics = {
  distinctSessions: number;
  stageCounts: Record<DecisionReportFunnelStage, number>;
  observedDropoff: {
    landedToGenerationStarted: DecisionReportDropoff;
    generationStartedToEditable: DecisionReportDropoff;
    editableToSaved: DecisionReportDropoff;
    savedToActivated: DecisionReportDropoff;
  };
  timingMs: {
    timeToEditable: DecisionReportSampleSummary;
    timeToSave: DecisionReportSampleSummary;
    timeToActivation: DecisionReportSampleSummary;
  };
  engagement: {
    editCount: DecisionReportSampleSummary;
    followUpCount: DecisionReportSampleSummary;
  };
  failures: {
    generation: DecisionReportFailureCount;
    save: DecisionReportFailureCount;
    activation: DecisionReportFailureCount;
    totalEvents: number;
  };
};

/** True median (mean of the two middle values on an even count). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Fold raw event rows into the DoD funnel metrics. Pure. */
export function computeFunnelMetrics(rows: FunnelEventRow[]): FunnelMetrics {
  const runs = new Set<string>();
  const committed = new Set<string>();
  const shipState = new Set<string>();
  const scorecardRuns = new Set<string>();
  const firstTypeMs: number[] = [];
  const stepRuns: Record<FunnelStep, Set<string>> = {
    paste: new Set(),
    card: new Set(),
    commit: new Set(),
    done: new Set(),
  };

  for (const r of rows) {
    // Decision Report lifecycle events share the append-only table, but they are
    // a separate funnel. They must not inflate the legacy funnel denominator or
    // any of its historical rates.
    if (!isLegacyFunnelEventType(r.eventType)) continue;
    runs.add(r.sessionKey);
    switch (r.eventType) {
      case "COMMITTED":
        committed.add(r.sessionKey);
        break;
      case "SHIP_STATE":
        shipState.add(r.sessionKey);
        break;
      case "SCORECARD_VIEW":
        scorecardRuns.add(r.sessionKey);
        break;
      case "FIRST_TYPE":
        if (typeof r.msSinceStart === "number" && Number.isFinite(r.msSinceStart)) {
          firstTypeMs.push(r.msSinceStart);
        }
        break;
      case "STEP_VIEW":
        if (r.step && r.step in stepRuns) {
          stepRuns[r.step as FunnelStep].add(r.sessionKey);
        }
        break;
    }
  }

  const landedRuns = runs.size;
  const committedRuns = committed.size;
  const underTarget = firstTypeMs.filter((ms) => ms < TIME_TO_FIRST_TYPE_TARGET_MS).length;
  // Return-rate: of the runs that committed, how many came back to a scorecard.
  const returnedRuns = [...scorecardRuns].filter((k) => committed.has(k)).length;

  return {
    landedRuns,
    committedRuns,
    commitRate: landedRuns === 0 ? null : committedRuns / landedRuns,
    timeToFirstType: {
      count: firstTypeMs.length,
      medianMs: median(firstTypeMs),
      underTargetRate: firstTypeMs.length === 0 ? null : underTarget / firstTypeMs.length,
    },
    dropOffByStep: {
      paste: stepRuns.paste.size,
      card: stepRuns.card.size,
      commit: stepRuns.commit.size,
      done: stepRuns.done.size,
    },
    shipStateRuns: shipState.size,
    resolutionReturnRate: committedRuns === 0 ? null : returnedRuns / committedRuns,
  };
}

const REPORT_STAGE_EVENT: Record<DecisionReportFunnelStage, DecisionReportFunnelEventType> = {
  landed: "REPORT_LANDED",
  generationStarted: "REPORT_GENERATION_STARTED",
  editable: "REPORT_EDITABLE",
  saved: "REPORT_SAVED",
  activated: "REPORT_ACTIVATED",
};

function dropoffBetween(previous: Set<string>, next: Set<string>): DecisionReportDropoff {
  const eligibleSessions = previous.size;
  let advancedSessions = 0;
  for (const sessionKey of previous) {
    if (next.has(sessionKey)) advancedSessions += 1;
  }
  const droppedSessions = eligibleSessions - advancedSessions;
  return {
    eligibleSessions,
    advancedSessions,
    droppedSessions,
    dropoffRate: eligibleSessions === 0 ? null : droppedSessions / eligibleSessions,
  };
}

function earliestSample(target: Map<string, number>, sessionKey: string, value: unknown): void {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) return;
  const current = target.get(sessionKey);
  if (current === undefined || value < current) target.set(sessionKey, value);
}

function greatestCount(target: Map<string, number>, sessionKey: string, value: unknown): void {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) return;
  const current = target.get(sessionKey);
  if (current === undefined || value > current) target.set(sessionKey, value);
}

function summarizeSamples(samples: Map<string, number>): DecisionReportSampleSummary {
  return {
    sampledSessions: samples.size,
    median: median([...samples.values()]),
  };
}

function failureCount(events: number, sessions: Set<string>): DecisionReportFailureCount {
  return { events, sessions: sessions.size };
}

/**
 * Fold the Decision Report lifecycle without changing the legacy funnel. Stage
 * counts and timing samples are distinct-session metrics; repeated saves and
 * retries therefore cannot inflate conversion. Failure event counts retain the
 * retry signal while also exposing the deduplicated affected-session count.
 */
export function computeDecisionReportFunnelMetrics(
  rows: FunnelEventRow[],
): DecisionReportFunnelMetrics {
  const distinctSessions = new Set<string>();
  const stages = Object.fromEntries(
    DECISION_REPORT_FUNNEL_STAGES.map((stage) => [stage, new Set<string>()]),
  ) as Record<DecisionReportFunnelStage, Set<string>>;
  const timing = {
    editable: new Map<string, number>(),
    saved: new Map<string, number>(),
    activated: new Map<string, number>(),
  };
  const engagement = {
    edits: new Map<string, number>(),
    followUps: new Map<string, number>(),
  };
  const failedSessions = {
    generation: new Set<string>(),
    save: new Set<string>(),
    activation: new Set<string>(),
  };
  const failureEvents = { generation: 0, save: 0, activation: 0 };

  for (const row of rows) {
    if (!isDecisionReportFunnelEventType(row.eventType) || !row.sessionKey) continue;
    distinctSessions.add(row.sessionKey);

    for (const stage of DECISION_REPORT_FUNNEL_STAGES) {
      if (row.eventType === REPORT_STAGE_EVENT[stage]) stages[stage].add(row.sessionKey);
    }

    if (row.eventType === "REPORT_EDITABLE") {
      earliestSample(timing.editable, row.sessionKey, row.msSinceStart);
    } else if (row.eventType === "REPORT_SAVED") {
      earliestSample(timing.saved, row.sessionKey, row.msSinceStart);
    } else if (row.eventType === "REPORT_ACTIVATED") {
      earliestSample(timing.activated, row.sessionKey, row.msSinceStart);
    } else if (row.eventType === "REPORT_GENERATION_FAILED") {
      failureEvents.generation += 1;
      failedSessions.generation.add(row.sessionKey);
    } else if (row.eventType === "REPORT_SAVE_FAILED") {
      failureEvents.save += 1;
      failedSessions.save.add(row.sessionKey);
    } else if (row.eventType === "REPORT_ACTIVATION_FAILED") {
      failureEvents.activation += 1;
      failedSessions.activation.add(row.sessionKey);
    }

    const meta = row.meta;
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      greatestCount(engagement.edits, row.sessionKey, meta.editCount);
      greatestCount(engagement.followUps, row.sessionKey, meta.followUpCount);
    }
  }

  return {
    distinctSessions: distinctSessions.size,
    stageCounts: Object.fromEntries(
      DECISION_REPORT_FUNNEL_STAGES.map((stage) => [stage, stages[stage].size]),
    ) as Record<DecisionReportFunnelStage, number>,
    observedDropoff: {
      landedToGenerationStarted: dropoffBetween(stages.landed, stages.generationStarted),
      generationStartedToEditable: dropoffBetween(stages.generationStarted, stages.editable),
      editableToSaved: dropoffBetween(stages.editable, stages.saved),
      savedToActivated: dropoffBetween(stages.saved, stages.activated),
    },
    timingMs: {
      timeToEditable: summarizeSamples(timing.editable),
      timeToSave: summarizeSamples(timing.saved),
      timeToActivation: summarizeSamples(timing.activated),
    },
    engagement: {
      editCount: summarizeSamples(engagement.edits),
      followUpCount: summarizeSamples(engagement.followUps),
    },
    failures: {
      generation: failureCount(failureEvents.generation, failedSessions.generation),
      save: failureCount(failureEvents.save, failedSessions.save),
      activation: failureCount(failureEvents.activation, failedSessions.activation),
      totalEvents:
        failureEvents.generation + failureEvents.save + failureEvents.activation,
    },
  };
}
