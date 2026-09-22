import { after, NextResponse } from "next/server";
import { beginGa4, ga4Command, ga4Context, syncGa4, validateGa4Origin } from "@/lib/ga4/server";
import { Ga4Error } from "@/lib/ga4/google";

export const runtime = "nodejs";
export const maxDuration = 300;
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

async function bodyJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json") || !request.body) throw new Ga4Error("invalid_request");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 16384) throw new Ga4Error("invalid_request");
      chunks.push(value);
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Ga4Error("invalid_request");
    return parsed;
  } catch { throw new Ga4Error("invalid_request"); }
  finally { await reader.cancel().catch(() => undefined); }
}

export async function POST(request: Request) {
  try {
    const context = await ga4Context();
    validateGa4Origin(request, context.config);
    const body = await bodyJson(request);
    if (body.action === "start") {
      const started = await beginGa4(context, body.connectionId);
      const response = NextResponse.json({ url: started.url }, { headers });
      response.cookies.set("causent_ga4_state", started.state, { httpOnly: true, secure: context.config.redirectUri.startsWith("https:"), sameSite: "lax", maxAge: 600, path: "/api/ga4" });
      return response;
    }
    const result = await ga4Command(context, body);
    if (body.action === "import" || body.action === "sync") after(async () => {
      try { const summary = await syncGa4(context.config); console.info("[ga4] sync", summary); }
      catch { console.error("[ga4] sync unavailable"); }
    });
    return NextResponse.json(result, { headers });
  } catch (error) {
    const code = error instanceof Ga4Error ? error.code : "unavailable";
    return NextResponse.json({ error: code }, { status: code === "permission" ? 403 : code === "invalid_request" ? 400 : 503, headers });
  }
}
