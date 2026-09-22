import { NextRequest, NextResponse } from "next/server";
import { ga4Config } from "@/lib/ga4/config";
import { completeGa4, ga4Context } from "@/lib/ga4/server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  let origin: string;
  try { origin = new URL(ga4Config().redirectUri).origin; }
  catch { return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
  const destination = new URL("/data-workshop", origin);
  try {
    const state = request.nextUrl.searchParams.get("state");
    if (!state || state !== request.cookies.get("causent_ga4_state")?.value || request.nextUrl.searchParams.has("error")) throw new Error("authorization_failed");
    await completeGa4(await ga4Context(), state, request.nextUrl.searchParams.get("code") ?? "");
    destination.searchParams.set("ga4", "connected");
  } catch { destination.searchParams.set("ga4", "retry"); }
  const response = NextResponse.redirect(destination, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set("causent_ga4_state", "", { path: "/api/ga4", maxAge: 0, httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax" });
  return response;
}
