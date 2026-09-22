import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { syncGa4 } from "@/lib/ga4/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (process.env.CAUSENT_GA4_ENABLED !== "1") return NextResponse.json({ status: "disabled" });
  try {
    const summary = await syncGa4();
    console.info("[ga4] sync", summary);
    return NextResponse.json(summary, { status: summary.failed ? 502 : 200 });
  } catch {
    console.error("[ga4] sync unavailable");
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
