import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getServiceRoleSupabase } from "@/lib/supabase-server";
import { GENERATION_REQUEST_ID, generationState } from "@/lib/decision-reports/generation-admission";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const session = await getSession();
    if (!session.userId) return NextResponse.json({ error: "Sign in" }, { status: 401 });
    const body = await request.json();
    if (typeof body.requestId !== "string" || !GENERATION_REQUEST_ID.test(body.requestId)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const status = await generationState(getServiceRoleSupabase(), {
      requestId: body.requestId, scopeId: null, actorId: session.userId,
    }, "cancel");
    return NextResponse.json({ status }, { status: status === "forbidden" || status === "missing" ? 404 : 200 });
  } catch {
    return NextResponse.json({ error: "Cancellation unavailable. Try again." }, { status: 503 });
  }
}
