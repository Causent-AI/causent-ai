// Jira webhook processing (#19) — the parallel of lib/levers/webhook.ts for Jira.
// Verify (shared secret) + dedup + detect, injected client so it is exercised
// with SYNTHETIC payloads and zero live Jira. The thin route
// (app/api/webhooks/jira/route.ts) only reads the raw body + secret header.
//
// Same durable-inbox invariants as the GitHub path. Jira has no
// per-delivery id header, so provider_event_id is composed deterministically from
// (issue id, webhookEvent, timestamp), while a SHA-256 payload digest rejects a
// changed body reusing that identity.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseJiraEvent,
  verifyJiraSecret,
  type JiraWebhookPayload,
  type ParsedJiraEvent,
} from "../connectors/jira.ts";
import {
  connectorHttpsOrigin,
  connectorPayloadDigest,
  connectorWebhookBodyIsBounded,
  processVerifiedConnectorEvent,
} from "./webhook-inbox.ts";

export type JiraWebhookParams = {
  rawBody: string;
  /** The secret the caller presented (header/query); compared to `secret`. */
  providedSecret: string | null;
  secret: string;
  nowIso?: string;
};

export type JiraWebhookOutcome = {
  status: number;
  result:
    | "detected"
    | "duplicate"
    | "ignored_no_provenance"
    | "ignored_no_lever"
    | "ignored_untracked_action"
    | "queued_retry"
    | "quarantined"
    | "dead_letter"
    | "payload_conflict"
    | "invalid_secret"
    | "bad_request";
  leverId?: string;
};

/** Deterministic dedup key: (issue id, event, timestamp). A redelivery of the
 *  exact same Jira event produces the same id and conflicts on the unique index. */
function jiraEventId(payload: JiraWebhookPayload, event: ParsedJiraEvent, targetOrigin: string): string {
  const id = payload.issue?.id ?? event.issueKey ?? "unknown";
  const ts = payload.timestamp ?? "";
  return `jira:${connectorPayloadDigest(targetOrigin)}:${id}:${payload.webhookEvent ?? "?"}:${ts}`;
}

function jiraProjectKey(issueKey: string | null): string | null {
  const match = /^([A-Z][A-Z0-9_]*)-\d+$/i.exec(issueKey ?? "");
  return match?.[1]?.toUpperCase() ?? null;
}

export async function processJiraWebhook(
  sb: SupabaseClient,
  params: JiraWebhookParams,
): Promise<JiraWebhookOutcome> {
  if (!verifyJiraSecret(params.secret, params.providedSecret)) {
    return { status: 401, result: "invalid_secret" };
  }
  if (!connectorWebhookBodyIsBounded(params.rawBody)) {
    return { status: 413, result: "bad_request" };
  }

  let payload: JiraWebhookPayload;
  try {
    payload = JSON.parse(params.rawBody) as JiraWebhookPayload;
  } catch {
    return { status: 400, result: "bad_request" };
  }

  const event = parseJiraEvent(payload);
  if (!event.token || !event.canonical || !event.externalRef) {
    return { status: 200, result: "ignored_no_provenance" };
  }
  const targetRef = jiraProjectKey(event.issueKey);
  const targetOrigin = connectorHttpsOrigin(event.self);
  if (!targetRef || !targetOrigin) return { status: 400, result: "bad_request" };

  const nowIso = params.nowIso ?? new Date().toISOString();
  return processVerifiedConnectorEvent(sb, {
    provider: "jira",
    providerEventId: jiraEventId(payload, event, targetOrigin),
    rawBody: params.rawBody,
    rawPayload: payload as unknown as Record<string, unknown>,
    provenanceToken: event.token,
    targetRef,
    targetOrigin,
    canonical: event.canonical,
    externalRef: event.externalRef,
    externalUrl: event.self,
    providerStatus: payload.webhookEvent ?? null,
    transitionTs: nowIso,
  });
}
