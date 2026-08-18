import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Canonical } from "../connectors/github.ts";

export const MAX_CONNECTOR_WEBHOOK_BYTES = 512 * 1024;

export type VerifiedConnectorEvent = {
  provider: "github" | "jira";
  providerEventId: string;
  rawBody: string;
  rawPayload: Record<string, unknown>;
  provenanceToken: string;
  targetRef: string;
  targetOrigin: string;
  canonical: Canonical;
  externalRef: string;
  externalUrl: string | null;
  providerStatus: string | null;
  transitionTs: string;
};

export type ConnectorInboxOutcome = {
  status: number;
  result:
    | "detected"
    | "duplicate"
    | "ignored_untracked_action"
    | "queued_retry"
    | "quarantined"
    | "dead_letter"
    | "payload_conflict"
    | "bad_request";
  leverId?: string;
  attempts?: number;
};

export function connectorPayloadDigest(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

export function connectorWebhookBodyIsBounded(rawBody: string): boolean {
  return Buffer.byteLength(rawBody, "utf8") <= MAX_CONNECTOR_WEBHOOK_BYTES;
}

export function connectorHttpsOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * Hand one already-authenticated, normalized provider event to the durable
 * inbox boundary. The RPC owns deduplication, canonical mutation, retry state,
 * and the final processed marker in a single transaction.
 */
export async function processVerifiedConnectorEvent(
  sb: SupabaseClient,
  input: VerifiedConnectorEvent,
): Promise<ConnectorInboxOutcome> {
  if (!connectorWebhookBodyIsBounded(input.rawBody)) {
    return { status: 413, result: "bad_request" };
  }

  const response = await sb.rpc("process_connector_webhook_v1", {
    p_provider: input.provider,
    p_provider_event_id: input.providerEventId,
    p_payload_digest: connectorPayloadDigest(input.rawBody),
    p_provenance_token: input.provenanceToken,
    p_target_ref: input.targetRef,
    p_target_origin: input.targetOrigin,
    p_canonical: input.canonical,
    p_external_ref: input.externalRef,
    p_external_url: input.externalUrl,
    p_provider_status: input.providerStatus,
    p_transition_ts: input.transitionTs,
    p_raw_payload: input.rawPayload,
  });
  if (response.error) return { status: 500, result: "bad_request" };

  const row = Array.isArray(response.data)
    ? response.data[0] as {
      result?: string;
      resolved_lever_id?: string | null;
      attempt_count?: number;
    } | undefined
    : undefined;
  if (!row?.result) return { status: 500, result: "bad_request" };

  const attempts = typeof row.attempt_count === "number" ? row.attempt_count : undefined;
  if (row.result === "queued_retry") {
    return { status: 202, result: "queued_retry", attempts };
  }
  if (row.result === "quarantined") {
    return { status: 202, result: "quarantined", attempts };
  }
  if (row.result === "dead_letter") {
    return { status: 500, result: "dead_letter", attempts };
  }
  if (row.result === "payload_conflict") {
    return { status: 409, result: "payload_conflict", attempts };
  }
  if (
    row.result !== "detected"
    && row.result !== "duplicate"
    && row.result !== "ignored_untracked_action"
  ) {
    return { status: 500, result: "bad_request", attempts };
  }
  return {
    status: 200,
    result: row.result,
    leverId: row.resolved_lever_id ?? undefined,
    attempts,
  };
}
