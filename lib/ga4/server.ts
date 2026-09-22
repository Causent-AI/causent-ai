import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/supabase-server";
import { kickCausalRecompute } from "@/lib/causal/recompute";
import { ga4Config, type Ga4Config } from "./config";
import { openToken, sealToken, stateHash } from "./crypto";
import { dailyRange, syncRange, Ga4Error, GoogleAnalytics, metricSelection, propertyId, type Ga4Metric } from "./google";

export type Ga4Connection = {
  connection_id: string; scope_id: string; actor_id: string; status: string; property_id: string | null;
  property_name: string | null; timezone: string | null; generation: number; last_sync_at: string | null; error_code: string | null;
};
type Mapping = { mapping_id: string; metric_id: string; provider_metric: Ga4Metric; event_name: string; lastAcceptedEnd: string | null };
type Lease = { connection: Ga4Connection; refreshCipher: string; leaseId: string; mappings: Mapping[] };
type Context = { sb: SupabaseClient; actorId: string; scopeId: string; config: Ga4Config };

function workerClient(config: Ga4Config): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("GA4_DATABASE_CONFIG");
  return createClient(url, key, { global: { headers: { Authorization: `Bearer ${config.workerJwt}` },
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(init?.signal ? [init.signal] : [])]) }) },
    auth: { persistSession: false, autoRefreshToken: false } });
}

async function rpc<T>(sb: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Ga4Error(error.code === "42501" ? "permission" : error.code === "22023" ? "invalid_request" : "unavailable");
  return data as T;
}

function worker<T>(config: Ga4Config, action: string, payload: Record<string, unknown>): Promise<T> {
  return rpc<T>(workerClient(config), "ga4_worker_v1", { p_action: action, p_payload: payload });
}

export async function ga4Context(): Promise<Context> {
  const config = ga4Config();
  const sb = await getServerSupabase();
  const [{ data, error }, session] = await Promise.all([sb.auth.getUser(), getSession()]);
  if (error || !data.user || data.user.id !== session.userId) throw new Ga4Error("permission");
  const access = await sb.rpc("has_scope_access", { target_scope: session.workspaceId, min_role: "admin" });
  if (access.error || access.data !== true) throw new Ga4Error("permission");
  return { sb, actorId: data.user.id, scopeId: session.workspaceId, config };
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)) throw new Ga4Error("invalid_request");
  return value;
}

export function validateGa4Origin(request: Request, config: Ga4Config): void {
  if (request.headers.get("origin") !== new URL(config.redirectUri).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new Ga4Error("permission");
}

export async function beginGa4(context: Context, connectionId: unknown): Promise<{ state: string; url: string }> {
  const state = randomBytes(32).toString("base64url");
  await rpc(context.sb, "ga4_manage_v1", { p_action: "begin", p_scope: context.scopeId,
    p_connection: connectionId ? uuid(connectionId) : null, p_payload: { stateHash: stateHash(state) } });
  return { state, url: new GoogleAnalytics(context.config).authorizationUrl(state) };
}

export async function completeGa4(context: Context, state: string, code: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(state) || !code || code.length > 4096) throw new Ga4Error("invalid_request");
  const payload = { stateHash: stateHash(state), actorId: context.actorId };
  const target = await worker<{ scopeId: string; connectionId: string }>(context.config, "oauth_target", payload);
  const google = new GoogleAnalytics(context.config);
  const tokens = await google.token({ code });
  const subject = await google.subject(tokens.accessToken);
  await worker(context.config, "oauth", { ...payload, subject,
    refreshCipher: tokens.refreshToken ? sealToken(tokens.refreshToken, context.config.encryptionKey, `${target.scopeId}:${target.connectionId}`) : null });
}

function leasePayload(lease: Lease): Record<string, unknown> {
  return { connectionId: lease.connection.connection_id, leaseId: lease.leaseId, generation: lease.connection.generation };
}

async function accessToken(config: Ga4Config, lease: Lease, google = new GoogleAnalytics(config)): Promise<string> {
  const binding = `${lease.connection.scope_id}:${lease.connection.connection_id}`;
  const tokens = await google.token({ refreshToken: openToken(lease.refreshCipher, config.encryptionKey, binding) });
  if (tokens.refreshToken) await worker(config, "rotate", { ...leasePayload(lease), refreshCipher: sealToken(tokens.refreshToken, config.encryptionKey, binding) });
  return tokens.accessToken;
}

async function failLease(config: Ga4Config, lease: Lease, error: unknown): Promise<void> {
  const code = error instanceof Ga4Error && error.code !== "invalid_request" ? error.code : "unavailable";
  await worker(config, "fail", { ...leasePayload(lease), code }).catch(() => undefined);
}

async function withLease<T>(context: Context, connectionId: unknown, operation: (lease: Lease, google: GoogleAnalytics, token: string) => Promise<T>): Promise<T> {
  const lease = await worker<Lease>(context.config, "lease", { connectionId: uuid(connectionId), scopeId: context.scopeId, actorId: context.actorId });
  try {
    const google = new GoogleAnalytics(context.config);
    const token = await accessToken(context.config, lease, google);
    const result = await operation(lease, google, token);
    await worker(context.config, "release", leasePayload(lease));
    return result;
  } catch (error) { await failLease(context.config, lease, error); throw error; }
}

export async function ga4Command(context: Context, body: Record<string, unknown>): Promise<unknown> {
  if (body.action === "properties") return withLease(context, body.connectionId, async (_lease, google, token) => ({ properties: await google.properties(token) }));
  if (body.action === "preview") {
    const selection = metricSelection(body.metric, body.event ?? "");
    return withLease(context, body.connectionId, async (lease, google, token) => {
      const property = await google.property(token, propertyId(body.propertyId));
      if (lease.connection.property_id && lease.connection.property_id !== property.id) throw new Ga4Error("invalid_request");
      return { property, report: await google.report(token, property, selection.metric, selection.event, dailyRange(property.timezone, 180)) };
    });
  }
  if (body.action === "import") {
    if (!Array.isArray(body.metrics) || body.metrics.length < 1 || body.metrics.length > 3) throw new Ga4Error("invalid_request");
    const metrics = body.metrics.map((value) => {
      if (!value || typeof value !== "object") throw new Ga4Error("invalid_request");
      const item = value as Record<string, unknown>;
      if (!["higher", "lower", "neutral"].includes(String(item.direction))) throw new Ga4Error("invalid_request");
      return { ...metricSelection(item.metric, item.event ?? ""), direction: item.direction };
    });
    const lease = await worker<Lease>(context.config, "lease", { connectionId: uuid(body.connectionId), scopeId: context.scopeId, actorId: context.actorId });
    try {
      const token = await accessToken(context.config, lease);
      const property = await new GoogleAnalytics(context.config).property(token, propertyId(body.propertyId));
      await worker(context.config, "configure", { ...leasePayload(lease), propertyId: property.id, propertyName: property.name, timezone: property.timezone, metrics });
      return { queued: true };
    } catch (error) { await failLease(context.config, lease, error); throw error; }
  }
  if (body.action === "disconnect") {
    // Local invalidation commits first; no network request can keep collection alive.
    const connectionId = uuid(body.connectionId);
    const removed = await worker<{ refreshCipher: string | null; scopeId: string }>(context.config, "disconnect", { connectionId, scopeId: context.scopeId, actorId: context.actorId });
    let providerRevoked = !removed.refreshCipher;
    if (removed.refreshCipher) {
      try {
        await new GoogleAnalytics(context.config).revoke(openToken(removed.refreshCipher, context.config.encryptionKey, `${removed.scopeId}:${connectionId}`));
        providerRevoked = true;
      } catch { /* Local deletion is authoritative even when Google is unavailable. */ }
    }
    return { status: "disconnected", providerRevoked };
  }
  if (body.action === "sync") {
    await rpc(context.sb, "ga4_manage_v1", { p_action: "sync", p_scope: context.scopeId, p_connection: uuid(body.connectionId), p_payload: {} });
    return { status: "queued" };
  }
  throw new Ga4Error("invalid_request");
}

export async function syncGa4(config = ga4Config()): Promise<{ processed: number; failed: number }> {
  const result = { processed: 0, failed: 0 };
  const deadline = Date.now() + 220_000;
  for (let i = 0; i < 4 && Date.now() < deadline; i++) {
    const lease = await worker<Lease | null>(config, "claim", {});
    if (!lease) break;
    try {
      const google = new GoogleAnalytics(config, fetch, deadline);
      const token = await accessToken(config, lease, google);
      const property = await google.property(token, lease.connection.property_id!);
      if (property.timezone !== lease.connection.timezone) throw new Ga4Error("invalid_response");
      const reports = [];
      for (const mapping of lease.mappings) {
        if (Date.now() > deadline) throw new Ga4Error("unavailable");
        const range = syncRange(property.timezone, config.overlapDays, mapping.lastAcceptedEnd);
        reports.push({ mappingId: mapping.mapping_id, report: await google.report(token, property, mapping.provider_metric, mapping.event_name, range) });
      }
      await worker(config, "publish", { ...leasePayload(lease), reports });
      result.processed++;
      // Database publication already queued recompute; the cron remains the fallback.
      await kickCausalRecompute({ scopeId: lease.connection.scope_id, limit: 3 }, { timeoutMs: 1000 }).catch(() => undefined);
    } catch (error) { result.failed++; await failLease(config, lease, error); }
  }
  return result;
}
