// Optional LLM "polish" seam for the summary layer.
//
// The deterministic core (generate.ts) is the source of truth. Polishing may ONLY
// rephrase surface prose; it can never change what the numbers say. This module
// is OFF by default (noopPolisher) and, when a real polisher is wired in, every
// trust-critical field is re-asserted from the deterministic draft after polish —
// so a hallucinating or adversarial model can never upgrade or invent a claim.
//
// No live model is called here. A production polisher would implement
// SummaryPolisher against the Anthropic API behind this same interface.

import { generateSummary } from "./generate.ts";
import { ESTIMATED_NOT_PROVEN, METHOD_LABEL, type ReadoutRow, type Summary } from "./types.ts";

/** The seam. Implementations rephrase `draft.headline` / `draft.detail` only. */
export interface SummaryPolisher {
  polish(input: { row: ReadoutRow; draft: Summary }): Promise<Summary>;
}

/** Default: no polish. The deterministic draft is returned untouched. */
export const noopPolisher: SummaryPolisher = {
  async polish({ draft }) {
    return draft;
  },
};

/** Invented-certainty / naive-elevation / prompt-injection tokens that the honest
 *  deterministic core PROVABLY never emits (the adversarial eval asserts this on
 *  every scenario). Their presence in polished prose means the polisher tried to
 *  manufacture a claim the numbers don't support, so we drop the polished prose
 *  and fall back to the deterministic draft. Note the core's own honest phrasings
 *  ("Estimated impact, not proven", "not a causal estimate", "does NOT make it
 *  more trustworthy") are deliberately NOT matched here. */
const FORBIDDEN_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bproves?\b/i, // "proves" / "prove" — the core only ever says "not proven"
  /\bguarantee/i, // guarantee(d/s)
  /\bdefinitely\b/i,
  /\bconfirmed\b/i,
  /\bcertaint/i, // certainty / certainties
  /\birrefutabl/i,
  /\bundeniabl/i,
  /\bmost (?:reliable|trustworthy|accurate)\b/i, // naive-method elevation
  /\bmore accurate than\b/i,
  /ignore (?:all |your )?previous/i, // prompt-injection echo
  /disregard (?:all |the )?(?:above|previous|prior)/i,
  /^\s*system\s*:/im, // injected fake "system:" directive
];

/** True when text manufactures certainty / elevates the naive check / echoes a
 *  prompt injection — i.e. content the honest core never produces. The bare word
 *  "proven" is honest ONLY inside "(un)proven"/"not proven"; strip those first. */
export function violatesHonestyClaim(text: string): boolean {
  const scrubbed = text
    .toLowerCase()
    .replace(/\bnot proven\b/g, "")
    .replace(/\bunproven\b/g, "")
    .replace(/\bdisproven\b/g, "");
  if (/\bproven\b/.test(scrubbed)) return true;
  return FORBIDDEN_CLAIM_PATTERNS.some((re) => re.test(text));
}

/** Re-assert every trust-critical field from the deterministic draft. The polisher
 *  may rephrase the headline and detail lines ONLY — it can never change the
 *  verdict, and any polished prose that invents certainty, elevates the descriptive
 *  check, or echoes a prompt injection is discarded in favour of the core draft.
 *  A directional headline that silently lost the "estimated, not proven" lead is
 *  likewise reverted. Prose may change; the honest claim may not. */
export function enforceInvariants(draft: Summary, polished: Summary): Summary {
  const directional = draft.claimStrength === "confident" || draft.claimStrength === "tentative";
  const lostLead =
    directional && !polished.headline.toLowerCase().includes(ESTIMATED_NOT_PROVEN.toLowerCase());
  const headline =
    lostLead || violatesHonestyClaim(polished.headline)
      ? draft.headline // polisher stripped the lead or manufactured a claim — fall back to the core
      : polished.headline;

  // The polisher may rephrase individual detail lines, but if ANY line manufactures
  // certainty / elevates the naive check, the whole detail block reverts to the core.
  const detail = polished.detail.some(violatesHonestyClaim) ? draft.detail : polished.detail;

  return {
    headline,
    detail,
    // Everything below is load-bearing for trust and is NEVER taken from the polisher.
    caveat: draft.caveat,
    method: METHOD_LABEL,
    claimStrength: draft.claimStrength,
    gatheringData: draft.gatheringData,
    disagreement: draft.disagreement,
  };
}

/** Generate a summary, optionally routing the draft through a polisher. The
 *  polisher is invariant-clamped, so the honest verdict is identical either way. */
export async function generateSummaryWithPolish(
  row: ReadoutRow,
  polisher: SummaryPolisher = noopPolisher,
): Promise<Summary> {
  const draft = generateSummary(row);
  const polished = await polisher.polish({ row, draft });
  return enforceInvariants(draft, polished);
}
