// Resolution cron (#18) — the scheduled trigger that resolves due predictions
// at their resolution_date. Unauthenticated route (excluded from the proxy
// guard), protected by CRON_SECRET exactly like reconcile-levers: Vercel Cron
// sends `Authorization: Bearer <CRON_SECRET>`.
//
// SCHEDULE (vercel.json): every five minutes. Vercel crons are UTC ONLY. The
// route preserves the product's 15:00 UTC business-day cutoff: before 15:00 it
// sweeps only through the previous UTC date, and from 15:00 onward it includes
// the current date. Frequent bounded runs drain more than 20 due workspaces
// without resolving a decision the evening before a partner's morning.
//
// The verdict machine lives in the Python engine (engine/persistence/resolve.py);
// this route NEVER re-implements resolution. It only picks HOW to reach it:
//
//   * PROD (serverless — no Python venv): POST the deployed resolution function
//     (project `causent-resolve`, scripts/deploy-resolve.sh) at CAUSENT_RESOLVE_URL
//     with the shared secret CAUSENT_RESOLVE_SECRET. This is the "port": the same
//     resolve_due_predictions sweep, reachable over HTTP.
//   * DEV (local venv present): shell out to the SAME runner the "Resolve now"
//     affordance uses (engine/persistence/run_resolution.py).
//
// Loud degradation (mirrors reconcile-levers): when neither the remote URL nor a
// local venv resolves anything, the response says so plainly — a plain `curl`
// tells the truth, not a green 200 that silently did nothing.

import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { DEMO_WORKSPACES } from "@/lib/data/config";
import {
  listProductionResolutionTargets,
  mapWithConcurrency,
  RESOLUTION_WORKER_CONCURRENCY,
  ResolutionScopeDiscoveryError,
  resolutionDayForCron,
  resolutionWorkerPayload,
} from "@/lib/resolution/cron-scopes";
import {
  getServiceRoleSupabase,
  isLocalDemo,
} from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
// The remote fn call is fast; the local spawn path wants Node runtime headroom.
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/** PROD path: POST the deployed resolution function. Returns null when it isn't
 *  configured (so the caller can fall back to the local runner in dev). */
async function resolveViaRemote(
  url: string,
  secret: string,
  today: string | undefined,
  scopeId: string,
  userId: string | undefined,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-causent-resolve-secret": secret,
      },
      body: JSON.stringify(resolutionWorkerPayload(scopeId, userId, today)),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      body: { error: "resolution function unreachable", detail: String(err) },
    };
  }
  const body = await res.json().catch(() => ({ error: "non-JSON response from resolver" }));
  return { ok: res.ok, status: res.status, body };
}

/** DEV path: shell the Python runner (needs the local venv). */
async function runLocalResolution(
  scopeId: string,
  userId?: string,
): Promise<{ code: number | null; out: string }> {
  const engineDir = process.env.CAUSENT_ENGINE_DIR ?? path.join(process.cwd(), "engine");
  const python =
    process.env.CAUSENT_ENGINE_PYTHON ?? path.join(engineDir, ".venv", "bin", "python");
  const today = process.env.CAUSENT_DEMO_TODAY; // demo data lives in the past

  const args = [path.join("persistence", "run_resolution.py"), "--scope", scopeId];
  if (userId) args.push("--user", userId);
  if (today) args.push("--today", today);

  return new Promise((resolve) => {
    const child = spawn(python, args, { cwd: engineDir });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (err) => resolve({ code: null, out: String(err) }));
    child.on("close", (code) => resolve({ code, out }));
  });
}

type CronResolutionTarget = {
  scopeId: string;
  userId?: string;
  workspace?: string;
};

function demoTargets(): CronResolutionTarget[] {
  return DEMO_WORKSPACES.map((workspace) => ({
    scopeId: workspace.id,
    // Omit userId intentionally: both the remote and local demo runners retain
    // their existing server-owned demo-owner fallback.
    workspace: workspace.key,
  }));
}

function numericSummary(body: unknown): {
  processed: number;
  total: number;
  continuationRequired: boolean;
} {
  if (!body || typeof body !== "object") {
    return { processed: 0, total: 0, continuationRequired: false };
  }
  const record = body as Record<string, unknown>;
  return {
    processed: typeof record.processed === "number" && Number.isFinite(record.processed)
      ? Math.max(0, record.processed)
      : 0,
    total: typeof record.total === "number" && Number.isFinite(record.total)
      ? Math.max(0, record.total)
      : 0,
    continuationRequired: record.continuation_required === true,
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const remoteUrl = process.env.CAUSENT_RESOLVE_URL;
  const remoteSecret = process.env.CAUSENT_RESOLVE_SECRET;
  const today = process.env.CAUSENT_DEMO_TODAY;
  const localDemo = isLocalDemo();
  let resolutionDay = today;

  let targets: CronResolutionTarget[];
  let targetBatchTruncated = false;
  if (localDemo) {
    targets = demoTargets();
  } else {
    const productionResolutionDay = resolutionDayForCron(new Date());
    resolutionDay = productionResolutionDay;
    try {
      const batch = await listProductionResolutionTargets(
        getServiceRoleSupabase(),
        productionResolutionDay,
      );
      targets = batch.targets;
      targetBatchTruncated = batch.truncated;
    } catch (error) {
      const code = error instanceof ResolutionScopeDiscoveryError
        ? error.code
        : "unexpected_scope_discovery_failure";
      console.error(`[cron/resolve] production scope discovery failed: ${code}`);
      return NextResponse.json(
        { error: "resolution scope discovery failed" },
        { status: 500 },
      );
    }
  }

  // Prefer the deployed function whenever it's configured — the only path that
  // works in a serverless runtime. Production targets come only from due rows
  // plus a verified write-capable membership; caller input never chooses either
  // the scope or acting identity. Local demo retains its fixed fixture registry.
  if (remoteUrl && remoteSecret) {
    const workspaces = await mapWithConcurrency(
      targets,
      RESOLUTION_WORKER_CONCURRENCY,
      async (target) => ({
        workspace: target.workspace,
        outcome: await resolveViaRemote(
          remoteUrl,
          remoteSecret,
          resolutionDay,
          target.scopeId,
          target.userId,
        ),
      }),
    );
    const failed = workspaces.find(({ outcome }) => !outcome.ok);
    if (!localDemo) {
      if (failed) {
        console.error(
          `[cron/resolve] production resolver failed with downstream status ${failed.outcome.status}`,
        );
        return NextResponse.json(
          { error: "workspace resolution failed" },
          { status: 502 },
        );
      }
      const summaries = workspaces.map(({ outcome }) => numericSummary(outcome.body));
      return NextResponse.json({
        ok: true,
        resolver: "remote",
        workspaces: summaries.length,
        processed: summaries.reduce((total, summary) => total + summary.processed, 0),
        predictions: summaries.reduce((total, summary) => total + summary.total, 0),
        continuation_required:
          targetBatchTruncated || summaries.some((summary) => summary.continuationRequired),
      }, { status: 200 });
    }
    return NextResponse.json(
      {
        ...(failed ? { error: "workspace resolution failed" } : { ok: true }),
        resolver: "remote",
        workspaces: workspaces.map(({ workspace, outcome }) => ({
          workspace,
          ok: outcome.ok,
          status: outcome.status,
          result: outcome.body,
        })),
      },
      { status: failed?.outcome.status ?? 200 },
    );
  }

  // No remote configured — fall back to the local runner (dev). On Vercel there
  // is no Python venv, so this fails loudly rather than pretending to resolve.
  const workspaces = await Promise.all(
    targets.map(async (target) => ({
      workspace: target.workspace,
      result: await runLocalResolution(target.scopeId, target.userId),
    })),
  );
  const failed = workspaces.find(({ result }) => result.code !== 0);
  if (failed) {
    console.warn(
      "[cron/resolve] no CAUSENT_RESOLVE_URL and local runner failed — resolution " +
        "is degraded. Deploy causent-resolve (scripts/deploy-resolve.sh) and set " +
        "CAUSENT_RESOLVE_URL + CAUSENT_RESOLVE_SECRET on this project.",
    );
    return NextResponse.json(
      {
        error: "resolution runner failed",
        resolver: "local",
        hint: "set CAUSENT_RESOLVE_URL + CAUSENT_RESOLVE_SECRET to use the deployed function",
        ...(localDemo ? { workspace: failed.workspace } : {}),
        ...(localDemo
          ? { detail: failed.result.out.split("\n").slice(-4).join("\n") }
          : {}),
      },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    resolver: "local",
    workspaces: localDemo
      ? workspaces.map(({ workspace, result }) => ({
          workspace,
          summary: result.out
            .split("\n")
            .reverse()
            .find((line) => line.startsWith("RESULT:")) ?? "resolution sweep complete",
        }))
      : workspaces.length,
    continuation_required: targetBatchTruncated,
  }, { status: 200 });
}
