// Webhook processing core (#16) — verify + dedup + detect, injected client so it
// is exercised with SYNTHETIC signed payloads and zero live GitHub App. The thin
// route (app/api/webhooks/github/route.ts) only reads the raw body + headers and
// hands them here.
//
// The durable inbox RPC owns deduplication and applies the canonical transition,
// lever attribution, and processed marker atomically. A partial failure remains
// retryable instead of being hidden by transition_events' unique key.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseIssueEvent,
  verifyWebhookSignature,
  type IssueWebhookPayload,
} from "../connectors/github.ts";
import {
  connectorWebhookBodyIsBounded,
  processVerifiedConnectorEvent,
} from "./webhook-inbox.ts";

export type WebhookParams = {
  rawBody: string;
  signature: string | null;
  deliveryId: string | null;
  secret: string;
  /** Injected clock (ISO) for transition_ts / detected_at. */
  nowIso?: string;
};

export type WebhookOutcome = {
  status: number;
  /** Machine-readable result for the route's JSON + the tests. */
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
    | "invalid_signature"
    | "bad_request";
  leverId?: string;
};

function githubTargetRef(payload: IssueWebhookPayload): string | null {
  const declared = payload.repository?.full_name?.trim();
  if (declared && /^[^/\s]+\/[^/\s]+$/.test(declared)) return declared.toLowerCase();
  const issueUrl = payload.issue?.html_url;
  if (!issueUrl) return null;
  try {
    const parsed = new URL(issueUrl);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") return null;
    const [owner, repo] = parsed.pathname.split("/").filter(Boolean);
    return owner && repo ? `${owner}/${repo}`.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Verify a GitHub `issues` webhook, dedup it on (github, delivery_id), and — for
 * an issue that opened/reopened carrying Causent provenance — attribute the
 * matching lever. Everything else is a benign 200 ignore.
 */
export async function processIssueWebhook(
  sb: SupabaseClient,
  params: WebhookParams,
): Promise<WebhookOutcome> {
  if (!verifyWebhookSignature(params.secret, params.rawBody, params.signature)) {
    return { status: 401, result: "invalid_signature" };
  }
  if (!params.deliveryId) return { status: 400, result: "bad_request" };
  if (!connectorWebhookBodyIsBounded(params.rawBody)) {
    return { status: 413, result: "bad_request" };
  }

  let payload: IssueWebhookPayload;
  try {
    payload = JSON.parse(params.rawBody) as IssueWebhookPayload;
  } catch {
    return { status: 400, result: "bad_request" };
  }

  const event = parseIssueEvent(payload);
  if (!event.token || !event.canonical || !event.externalRef) {
    return { status: 200, result: "ignored_no_provenance" };
  }
  const targetRef = githubTargetRef(payload);
  if (!targetRef) return { status: 400, result: "bad_request" };

  const nowIso = params.nowIso ?? new Date().toISOString();
  return processVerifiedConnectorEvent(sb, {
    provider: "github",
    providerEventId: params.deliveryId,
    rawBody: params.rawBody,
    rawPayload: payload as unknown as Record<string, unknown>,
    provenanceToken: event.token,
    targetRef,
    targetOrigin: "https://github.com",
    canonical: event.canonical,
    externalRef: event.externalRef,
    externalUrl: event.htmlUrl,
    providerStatus: payload.action ?? null,
    transitionTs: nowIso,
  });
}
