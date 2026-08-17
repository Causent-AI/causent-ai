import { NextResponse } from "next/server";

import { kickDriftRefresh } from "@/lib/drift/refresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await kickDriftRefresh({ limit: 20 }, { timeoutMs: 290_000 });
  if (!result.ok) {
    const status = result.configured ? 502 : 503;
    const terminalSummary = result.error === "terminal_failure"
      ? result.summary
      : undefined;
    console.error("[cron/drift] worker request failed", {
      event: "drift_worker_failed",
      reason: result.error,
      upstreamStatus: "status" in result ? result.status : undefined,
      failed: terminalSummary?.failed,
      retryScheduled: terminalSummary?.retryScheduled,
      total: terminalSummary?.total,
    });
    return NextResponse.json(
      {
        error: result.error === "terminal_failure"
          ? "drift refresh jobs reached terminal failure"
          : "drift refresh worker unavailable",
        reason: result.error,
        ...(terminalSummary ? { summary: terminalSummary } : {}),
        ...(result.error === "not_configured"
          ? { hint: "configure CAUSENT_DRIFT_URL and CAUSENT_DRIFT_SECRET" }
          : {}),
      },
      { status },
    );
  }

  return NextResponse.json({ worker: "remote", result: result.body }, { status: 200 });
}
