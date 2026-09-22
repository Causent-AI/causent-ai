import type { JSONSchema7 } from "ai";
import {
  MODEL_CLAIM_KINDS,
  validateModelDecisionReportDraft,
  type ModelClaimDraft,
} from "./generation-contract.ts";
import { MAX_DECISION_REPORT_ACTIONS } from "./schema.ts";

const FIELDS = [
  "decision", "background", "problem", "factor", "plan", "customer",
  "stakeholder", "dataSource", "approvedModel", "actionTitle", "actionSummary", "actionOwner",
] as const;
type Field = (typeof FIELDS)[number];

// One repeated claim shape avoids compiling the same nested grammar for every
// report section. This transport shape never reaches report persistence.
export const REPORT_WIRE_SCHEMA: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  properties: {
    projectName: { type: "string" },
    title: { type: "string" },
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field: { type: "string", enum: [...FIELDS] },
          action: { type: "integer", description: "Zero-based action index; -1 for all non-action fields." },
          text: { type: "string" },
          kind: { type: "string", enum: [...MODEL_CLAIM_KINDS] },
          evidenceQuote: { type: "string" },
          evidenceSourceChunkId: { type: "string" },
        },
        required: ["field", "action", "text", "kind", "evidenceQuote", "evidenceSourceChunkId"],
      },
    },
    dataClassification: { type: "string", enum: ["private", "organization", "public", "unspecified"] },
    metricName: { type: "string" },
    metricDefinition: { type: "string" },
    baselinePct: { type: ["number", "null"] },
    baselineEvidenceQuote: { type: "string" },
    baselineSourceChunkId: { type: "string" },
    predictedPct: { type: ["number", "null"] },
    predictedEvidenceQuote: { type: "string" },
    predictedSourceChunkId: { type: "string" },
  },
  required: [
    "projectName", "title", "claims", "dataClassification", "metricName", "metricDefinition",
    "baselinePct", "baselineEvidenceQuote", "baselineSourceChunkId",
    "predictedPct", "predictedEvidenceQuote", "predictedSourceChunkId",
  ],
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function decodeReportWire(value: unknown): ReturnType<typeof validateModelDecisionReportDraft> {
  const invalid = () => ({ success: false as const, error: new Error("Generated report transport is malformed.") });
  if (!record(value) || !Array.isArray(value.claims) || value.claims.length > 100) return invalid();
  if (Object.keys(value).some((key) => !REPORT_WIRE_SCHEMA.required!.includes(key))) return invalid();
  const sections = new Map<Field, ModelClaimDraft[]>();
  const actions = new Map<number, Map<Field, ModelClaimDraft>>();
  for (const entry of value.claims) {
    if (!record(entry) || !FIELDS.includes(entry.field as Field) ||
      !Number.isInteger(entry.action) || typeof entry.text !== "string" ||
      !MODEL_CLAIM_KINDS.includes(entry.kind as ModelClaimDraft["kind"]) ||
      typeof entry.evidenceQuote !== "string" || typeof entry.evidenceSourceChunkId !== "string" ||
      Object.keys(entry).some((key) => !["field", "action", "text", "kind", "evidenceQuote", "evidenceSourceChunkId"].includes(key))) return invalid();
    const field = entry.field as Field;
    const claim: ModelClaimDraft = {
      text: entry.text, kind: entry.kind as ModelClaimDraft["kind"],
      evidenceQuote: entry.evidenceQuote, evidenceSourceChunkId: entry.evidenceSourceChunkId,
    };
    if (field.startsWith("action")) {
      const index = entry.action as number;
      if (index < 0 || index >= MAX_DECISION_REPORT_ACTIONS) return invalid();
      const action = actions.get(index) ?? new Map<Field, ModelClaimDraft>();
      if (action.has(field)) return invalid();
      action.set(field, claim);
      actions.set(index, action);
    } else {
      if (entry.action !== -1) return invalid();
      const values = sections.get(field) ?? [];
      if (values.length >= (["decision", "background", "problem", "plan"].includes(field) ? 1 : 3)) return invalid();
      values.push(claim);
      sections.set(field, values);
    }
  }
  const sortedActions = [...actions.entries()].sort(([a], [b]) => a - b);
  if (sortedActions.some(([index, action], position) => index !== position || !action.get("actionTitle")?.text.trim())) return invalid();
  const first = (field: Field) => sections.get(field)?.[0] ?? null;
  const list = (field: Field) => sections.get(field) ?? [];
  const draft = {
    projectName: value.projectName,
    title: value.title,
    decision: { decision: first("decision"), background: first("background"), problem: first("problem") },
    supportingEvidence: { factors: list("factor"), metricMechanism: null },
    implementation: {
      actionPlanSummary: first("plan"),
      actions: sortedActions.map(([, action]) => ({
        title: action.get("actionTitle")!.text,
        summary: action.get("actionSummary") ?? null,
        owner: action.get("actionOwner") ?? null,
      })),
      customers: list("customer"), stakeholders: list("stakeholder"),
      governance: {
        dataClassification: value.dataClassification,
        allowedDataSources: list("dataSource"), approvedModelNotes: list("approvedModel"),
      },
    },
    metric: {
      name: value.metricName, definition: value.metricDefinition,
      baselinePct: value.baselinePct, baselineEvidenceQuote: value.baselineEvidenceQuote,
      baselineSourceChunkId: value.baselineSourceChunkId,
      predictedPct: value.predictedPct, predictedEvidenceQuote: value.predictedEvidenceQuote,
      predictedSourceChunkId: value.predictedSourceChunkId,
    },
  };
  return validateModelDecisionReportDraft(draft);
}
