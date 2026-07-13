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

export const FUNNEL_EVENT_TYPES = [
  "LANDED",
  "STEP_VIEW",
  "FIRST_TYPE",
  "STRUCTURED",
  "COMMITTED",
  "SHIP_STATE",
  "SCORECARD_VIEW",
] as const;

export type FunnelEventType = (typeof FUNNEL_EVENT_TYPES)[number];

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
