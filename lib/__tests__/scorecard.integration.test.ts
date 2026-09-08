// Integration gate for resolution_date → scorecard (C5/#18): reads the DEMO
// scope's resolved predictions (seeded + resolved through the REAL verdict
// machine by seed_demo.py) and asserts each verdict class shapes into an honest
// scorecard surface — CONFIRMED shows predicted-vs-measured, UNMEASURABLE_NO_
// METRIC routes to the connect/self-report surface, GATHERING to the not-yet
// surface, and NONE throw. Skips honestly when the demo seed isn't present.
//
// This is the read side of the loop: seed_demo.py runs resolve.py; this proves
// the app-side shaping (lib/scorecard.ts) reads that output faithfully.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { before, test, type TestContext } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { shapeScorecard, type ResolutionTuple } from "../scorecard.ts";
import type { PredictionDirection, PredictionVerdict } from "../types.ts";

// The demo workspace (matches lib/data/config DEMO_SCOPE_ID + seed_demo SCOPE).
const DEMO_SCOPE_ID = "ca5e0000-0000-0000-0000-0000000000d3";

function loadEnvLocal(): Record<string, string> {
  try {
    const raw = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    const out: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith("#")) out[m[1]] = m[2];
    }
    return out;
  } catch {
    return {};
  }
}

const env = loadEnvLocal();
const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

type PredRow = {
  direction: PredictionDirection;
  magnitude_pct_mean: number;
  resolved_verdict: PredictionVerdict | null;
  resolution_tuple: ResolutionTuple;
};

let sb: SupabaseClient | null = null;
let rows: PredRow[] = [];
let seeded = false;

before(async () => {
  if (!URL || !KEY) return;
  sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const res = await sb
    .from("predictions")
    .select("direction, magnitude_pct_mean, resolved_verdict, resolution_tuple")
    .eq("scope_id", DEMO_SCOPE_ID)
    .not("resolved_verdict", "is", null)
    .then((r) => r, () => ({ data: null, error: new Error("unreachable") }));
  if (res.error || !res.data) return;
  rows = res.data as unknown as PredRow[];
  seeded = rows.length > 0;
});

function gated(t: TestContext): boolean {
  if (!seeded) {
    t.skip("demo seed not present — run engine/persistence/seed_demo.py");
    return false;
  }
  return true;
}

test("every seeded resolved verdict class shapes without throwing", (t) => {
  if (!gated(t)) return;
  for (const row of rows) {
    const sc = shapeScorecard({
      verdict: row.resolved_verdict!,
      committedDirection: row.direction,
      committedMagnitudePct: row.magnitude_pct_mean,
      tuple: row.resolution_tuple,
    });
    assert.equal(sc.verdict, row.resolved_verdict);
    // The predicted side is ALWAYS present — the human commitment on the record.
    assert.equal(sc.predicted.magnitudePct, row.magnitude_pct_mean);
  }
});

test("unregistered demo results explicitly refuse attribution", (t) => {
  if (!gated(t)) return;
  const refused = rows.find((row) => row.resolved_verdict === "UNRESOLVABLE");
  assert.ok(refused, "seed exercises unregistered refusal");
  const sc = shapeScorecard({ verdict: refused.resolved_verdict!, committedDirection: refused.direction,
    committedMagnitudePct: refused.magnitude_pct_mean, tuple: refused.resolution_tuple });
  assert.equal(sc.kind, "no-signal");
  assert.equal(sc.measured, null);
  assert.equal(sc.presentation.label, "Cannot attribute");
});

test("UNMEASURABLE_NO_METRIC routes to the connect/self-report surface", (t) => {
  if (!gated(t)) return;
  const unmeasurable = rows.find((r) => r.resolved_verdict === "UNMEASURABLE_NO_METRIC");
  assert.ok(unmeasurable, "seed exercises UNMEASURABLE_NO_METRIC");
  const sc = shapeScorecard({
    verdict: "UNMEASURABLE_NO_METRIC",
    committedDirection: unmeasurable!.direction,
    committedMagnitudePct: unmeasurable!.magnitude_pct_mean,
    tuple: unmeasurable!.resolution_tuple,
  });
  assert.equal(sc.kind, "unmeasurable");
  assert.equal(sc.measured, null); // never a fabricated readout
});

test("legacy demo significance never becomes work or AI confirmation", (t) => {
  if (!gated(t)) return;
  assert.ok(rows.length > 0);
  assert.equal(rows.some((row) => row.resolved_verdict === "CONFIRMED" || row.resolved_verdict === "DIRECTION_CONFIRMED"), false);
  for (const row of rows.filter((candidate) => candidate.resolved_verdict === "UNRESOLVABLE")) {
    assert.equal(row.resolution_tuple?.interpretation, "cannot_attribute");
    assert.equal(row.resolution_tuple?.individual_attribution, false);
    assert.equal(row.resolution_tuple?.ai_attribution, false);
  }
});
