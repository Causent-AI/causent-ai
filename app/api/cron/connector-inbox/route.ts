import { NextResponse } from "next/server";

import { getServiceRoleSupabase } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const response = await getServiceRoleSupabase().rpc("retry_connector_webhook_inbox_v1", {
    p_limit: 20,
  });
  if (response.error) {
    console.error("[cron/connector-inbox] retry failed", {
      event: "connector_inbox_retry_failed",
      code: response.error.code,
    });
    return NextResponse.json({ error: "connector retry failed" }, { status: 500 });
  }

  const rows = Array.isArray(response.data)
    ? response.data as Array<{ result?: string }>
    : [];
  return NextResponse.json({
    attempted: rows.length,
    processed: rows.filter((row) => row.result === "detected" || row.result === "ignored_untracked_action").length,
    deadLettered: rows.filter((row) => row.result === "dead_letter").length,
  });
}
