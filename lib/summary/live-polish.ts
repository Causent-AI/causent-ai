// Live LLM polisher for the summary layer (Phase B2).
//
// This is a REAL implementation of the SummaryPolisher seam (lib/summary/polish.ts)
// backed by the Anthropic Messages API. It is OFF the default path — nothing imports
// it at runtime — and exists so the SAME adversarial eval that runs against the
// mocked polishers can be pointed at a live model to confirm the guardrail holds
// end-to-end. Whatever the model returns, generateSummaryWithPolish() runs it
// through enforceInvariants(), so the honest verdict is identical to the core.
//
// Raw HTTPS (fetch) is used deliberately: this is an off-by-default eval seam, so we
// avoid adding an SDK runtime dependency. A production wiring should prefer the
// official `@anthropic-ai/sdk` behind this same SummaryPolisher interface.
//
// Model: claude-opus-4-8 (adaptive thinking). Requires ANTHROPIC_API_KEY.
// The polisher is intentionally FAIL-SAFE: on any missing key, network error, or
// unparseable response it returns the deterministic draft untouched.

import type { SummaryPolisher } from "./polish.ts";
import type { Summary } from "./types.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

const SYSTEM_PROMPT = [
  "You copy-edit an already-written, honest causal readout for a product analytics tool.",
  "You may ONLY improve the clarity and flow of the one-line `headline` and the `detail` lines.",
  "You MUST NOT change what the numbers say. Never add certainty, never claim something is",
  "'proven', 'guaranteed', or 'confirmed', never call the descriptive 14-day check more",
  "trustworthy than the OLS ITS estimate, and never drop the 'Estimated impact, not proven'",
  "lead from a directional headline. Return the same claim, only better worded.",
].join(" ");

type PolishOpts = {
  apiKey?: string;
  /** Override for tests; defaults to the real Anthropic endpoint. */
  fetchImpl?: typeof fetch;
};

/** Build a live Anthropic-backed polisher. Returns a fail-safe SummaryPolisher:
 *  the deterministic draft is returned untouched whenever a live call cannot be
 *  made or produces an unusable response. */
export function createAnthropicPolisher(opts: PolishOpts = {}): SummaryPolisher {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const doFetch = opts.fetchImpl ?? fetch;

  return {
    async polish({ draft }) {
      if (!apiKey) return draft;
      try {
        const res = await doFetch(ANTHROPIC_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 16000,
            thinking: { type: "adaptive" },
            system: SYSTEM_PROMPT,
            output_config: {
              format: {
                type: "json_schema",
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    headline: { type: "string" },
                    detail: { type: "array", items: { type: "string" } },
                  },
                  required: ["headline", "detail"],
                },
              },
            },
            messages: [
              {
                role: "user",
                content: JSON.stringify({ headline: draft.headline, detail: draft.detail }),
              },
            ],
          }),
        });
        if (!res.ok) return draft;
        const body = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
        const text = (body.content ?? [])
          .filter((b) => b.type === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join("");
        const parsed = JSON.parse(text) as { headline?: unknown; detail?: unknown };
        const headline = typeof parsed.headline === "string" ? parsed.headline : draft.headline;
        const detail =
          Array.isArray(parsed.detail) && parsed.detail.every((d) => typeof d === "string")
            ? (parsed.detail as string[])
            : draft.detail;
        const polished: Summary = { ...draft, headline, detail };
        return polished;
      } catch {
        return draft; // fail-safe: any error → the honest deterministic draft
      }
    },
  };
}
