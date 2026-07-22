import { randomUUID } from "node:crypto";
import type { JSONSchema7 } from "ai";

import type {
  Claim,
  DecisionReportV1,
  DraftAction,
  MetricProjection,
} from "./schema.ts";
import { validateDecisionReport } from "./schema.ts";

export const DECISION_REPORT_PROMPT_MIN_CHARS = 20;
export const DECISION_REPORT_PROMPT_MAX_CHARS = 6_000;
export const INITIAL_PROMPT_SOURCE_ID = "initial-prompt";

export const MODEL_CLAIM_KINDS = [
  "supported",
  "inference",
  "suggestion",
  "missing",
] as const;

export type ModelClaimKind = (typeof MODEL_CLAIM_KINDS)[number];

export type ModelClaimDraft = {
  text: string;
  kind: ModelClaimKind;
  evidenceQuote: string;
};

export type ModelActionDraft = {
  title: string;
  summary: ModelClaimDraft | null;
  owner: ModelClaimDraft | null;
};

export type ModelDecisionReportDraft = {
  projectName: string;
  title: string;
  decision: {
    decision: ModelClaimDraft | null;
    background: ModelClaimDraft | null;
    problem: ModelClaimDraft | null;
  };
  supportingEvidence: {
    factors: ModelClaimDraft[];
    metricMechanism: ModelClaimDraft | null;
  };
  implementation: {
    actionPlanSummary: ModelClaimDraft | null;
    actions: ModelActionDraft[];
    customers: ModelClaimDraft[];
    stakeholders: ModelClaimDraft[];
    governance: {
      dataClassification: "private" | "organization" | "public" | "unspecified";
      allowedDataSources: ModelClaimDraft[];
      approvedModelNotes: ModelClaimDraft[];
    } | null;
  };
  metric: {
    name: string;
    definition: string;
    baselinePct: number | null;
    baselineEvidenceQuote: string;
    predictedPct: number | null;
    predictedEvidenceQuote: string;
  };
};

export type DecisionReportGeneration = {
  report: DecisionReportV1;
  metricProjection: MetricProjection;
  workspaceName: string;
  projectName: string;
};

type IdFactory = () => string;

const claimDraftSchema: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: { type: "string", maxLength: 500 },
    kind: { type: "string", enum: [...MODEL_CLAIM_KINDS] },
    evidenceQuote: { type: "string", maxLength: 500 },
  },
  required: ["text", "kind", "evidenceQuote"],
};

const nullableClaimDraftSchema: JSONSchema7 = {
  ...claimDraftSchema,
  type: ["object", "null"],
};

const claimArraySchema = (maxItems: number): JSONSchema7 => ({
  type: "array",
  minItems: 0,
  maxItems,
  items: claimDraftSchema,
});

export const MODEL_DECISION_REPORT_JSON_SCHEMA: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  properties: {
    projectName: { type: "string", minLength: 1, maxLength: 120 },
    title: { type: "string", minLength: 1, maxLength: 180 },
    decision: {
      type: "object",
      additionalProperties: false,
      properties: {
        decision: nullableClaimDraftSchema,
        background: nullableClaimDraftSchema,
        problem: nullableClaimDraftSchema,
      },
      required: ["decision", "background", "problem"],
    },
    supportingEvidence: {
      type: "object",
      additionalProperties: false,
      properties: {
        factors: claimArraySchema(3),
        metricMechanism: nullableClaimDraftSchema,
      },
      required: ["factors", "metricMechanism"],
    },
    implementation: {
      type: "object",
      additionalProperties: false,
      properties: {
        actionPlanSummary: nullableClaimDraftSchema,
        actions: {
          type: "array",
          minItems: 0,
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string", minLength: 1, maxLength: 120 },
              summary: nullableClaimDraftSchema,
              owner: nullableClaimDraftSchema,
            },
            required: ["title", "summary", "owner"],
          },
        },
        customers: claimArraySchema(3),
        stakeholders: claimArraySchema(3),
        governance: {
          type: ["object", "null"],
          additionalProperties: false,
          properties: {
            dataClassification: {
              type: "string",
              enum: ["private", "organization", "public", "unspecified"],
            },
            allowedDataSources: claimArraySchema(3),
            approvedModelNotes: claimArraySchema(3),
          },
          required: [
            "dataClassification",
            "allowedDataSources",
            "approvedModelNotes",
          ],
        },
      },
      required: [
        "actionPlanSummary",
        "actions",
        "customers",
        "stakeholders",
        "governance",
      ],
    },
    metric: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 180 },
        definition: { type: "string", minLength: 1, maxLength: 500 },
        baselinePct: { type: ["number", "null"], minimum: 0, maximum: 100 },
        baselineEvidenceQuote: { type: "string", maxLength: 1_500 },
        predictedPct: { type: ["number", "null"], minimum: 0, maximum: 100 },
        predictedEvidenceQuote: { type: "string", maxLength: 1_500 },
      },
      required: [
        "name",
        "definition",
        "baselinePct",
        "baselineEvidenceQuote",
        "predictedPct",
        "predictedEvidenceQuote",
      ],
    },
  },
  required: [
    "projectName",
    "title",
    "decision",
    "supportingEvidence",
    "implementation",
    "metric",
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isModelClaim(value: unknown): value is ModelClaimDraft {
  return (
    isRecord(value) &&
    typeof value.text === "string" &&
    MODEL_CLAIM_KINDS.includes(value.kind as ModelClaimKind) &&
    typeof value.evidenceQuote === "string"
  );
}

function isNullableModelClaim(value: unknown): value is ModelClaimDraft | null {
  return value === null || isModelClaim(value);
}

function isClaimArray(value: unknown, max: number): value is ModelClaimDraft[] {
  return Array.isArray(value) && value.length <= max && value.every(isModelClaim);
}

export function validateModelDecisionReportDraft(
  value: unknown,
): { success: true; value: ModelDecisionReportDraft } | { success: false; error: Error } {
  if (!isRecord(value) || typeof value.projectName !== "string" || typeof value.title !== "string") {
    return { success: false, error: new Error("Generated report metadata is malformed.") };
  }

  const decision = value.decision;
  const evidence = value.supportingEvidence;
  const implementation = value.implementation;
  const metric = value.metric;

  if (
    !isRecord(decision) ||
    !isNullableModelClaim(decision.decision) ||
    !isNullableModelClaim(decision.background) ||
    !isNullableModelClaim(decision.problem) ||
    !isRecord(evidence) ||
    !isClaimArray(evidence.factors, 3) ||
    !isNullableModelClaim(evidence.metricMechanism) ||
    !isRecord(implementation) ||
    !isNullableModelClaim(implementation.actionPlanSummary) ||
    !Array.isArray(implementation.actions) ||
    implementation.actions.length > 3 ||
    !implementation.actions.every(
      (action) =>
        isRecord(action) &&
        typeof action.title === "string" &&
        isNullableModelClaim(action.summary) &&
        isNullableModelClaim(action.owner),
    ) ||
    !isClaimArray(implementation.customers, 3) ||
    !isClaimArray(implementation.stakeholders, 3) ||
    !(
      implementation.governance === null ||
      (isRecord(implementation.governance) &&
        ["private", "organization", "public", "unspecified"].includes(
          implementation.governance.dataClassification as string,
        ) &&
        isClaimArray(implementation.governance.allowedDataSources, 3) &&
        isClaimArray(implementation.governance.approvedModelNotes, 3))
    ) ||
    !isRecord(metric) ||
    typeof metric.name !== "string" ||
    typeof metric.definition !== "string" ||
    !isOptionalPercentage(metric.baselinePct) ||
    typeof metric.baselineEvidenceQuote !== "string" ||
    !isOptionalPercentage(metric.predictedPct) ||
    typeof metric.predictedEvidenceQuote !== "string"
  ) {
    return { success: false, error: new Error("Generated report does not match the Slice 2 contract.") };
  }

  return { success: true, value: value as ModelDecisionReportDraft };
}

function schemaExpectsStructuredValue(schema: JSONSchema7): boolean {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  return types.includes("object") || types.includes("array");
}

function schemaIncludesType(schema: JSONSchema7, type: "object" | "array"): boolean {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  return types.includes(type);
}

function normalizeStringifiedStructuredValues(value: unknown, schema: JSONSchema7): unknown {
  let candidate = value;
  if (typeof candidate === "string" && schemaExpectsStructuredValue(schema)) {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return value;
    }
  }

  if (schemaIncludesType(schema, "object") && isRecord(candidate) && schema.properties) {
    return Object.fromEntries(
      Object.entries(candidate).map(([key, child]) => {
        const childSchema = schema.properties?.[key];
        return [
          key,
          childSchema && typeof childSchema === "object"
            ? normalizeStringifiedStructuredValues(child, childSchema)
            : child,
        ];
      }),
    );
  }

  if (
    schemaIncludesType(schema, "array") &&
    Array.isArray(candidate) &&
    schema.items &&
    !Array.isArray(schema.items) &&
    typeof schema.items === "object"
  ) {
    return candidate.map((item) => normalizeStringifiedStructuredValues(item, schema.items as JSONSchema7));
  }

  return candidate;
}

export function recoverStringifiedModelDecisionReportDraft(
  text: string | undefined,
): ModelDecisionReportDraft | null {
  if (!text) return null;

  try {
    const parsed: unknown = JSON.parse(text);
    const candidates: unknown[] = [parsed];
    if (isRecord(parsed)) {
      const values = Object.values(parsed);
      if (values.length === 1 && isRecord(values[0])) {
        candidates.push(values[0]);
      }

      for (const value of values) {
        if (typeof value === "string") {
          try {
            candidates.push(JSON.parse(value));
          } catch {
            // Ordinary string fields are not recovery candidates.
          }
        }
      }
    }

    for (const candidate of candidates) {
      const normalized = normalizeStringifiedStructuredValues(
        candidate,
        MODEL_DECISION_REPORT_JSON_SCHEMA,
      );
      const validation = validateModelDecisionReportDraft(normalized);
      if (validation.success) return validation.value;
    }

    return null;
  } catch {
    return null;
  }
}

function isOptionalPercentage(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && value >= 0 && value <= 100);
}

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

function quoteIsSupported(quote: string, prompt: string): boolean {
  const candidate = normalized(quote);
  return candidate.length >= 8 && normalized(prompt).includes(candidate);
}

function numericTokens(value: string): string[] {
  return value.match(/\d+(?:[.,]\d+)?%?/g) ?? [];
}

function containsUnsupportedNumber(text: string, prompt: string): boolean {
  const promptTokens = new Set(numericTokens(prompt).map((token) => token.replace(/,/g, "")));
  return numericTokens(text).some((token) => !promptTokens.has(token.replace(/,/g, "")));
}

function missingClaim(id: string): Claim {
  return { id, text: "", status: "missing", sourceChunkIds: [] };
}

function mapClaim(
  draft: ModelClaimDraft,
  prompt: string,
  id: string,
  options: { sourceOnly?: boolean } = {},
): Claim {
  const text = draft.text.trim();
  if (draft.kind === "missing" || text === "") return missingClaim(id);

  const supported =
    draft.kind === "supported" && quoteIsSupported(draft.evidenceQuote, prompt);
  if (containsUnsupportedNumber(text, prompt)) return missingClaim(id);
  if (options.sourceOnly && !supported) return missingClaim(id);

  if (supported) {
    return {
      id,
      text,
      status: "sourced",
      sourceChunkIds: [INITIAL_PROMPT_SOURCE_ID],
    };
  }

  return {
    id,
    text,
    status: draft.kind === "suggestion" ? "suggested" : "inferred",
    sourceChunkIds: [],
  };
}

function mapClaimOrMissing(
  draft: ModelClaimDraft | null,
  prompt: string,
  id: string,
  options: { sourceOnly?: boolean } = {},
): Claim {
  return draft === null ? missingClaim(id) : mapClaim(draft, prompt, id, options);
}

function mapClaimArray(
  drafts: ModelClaimDraft[],
  prompt: string,
  prefix: string,
  idFactory: IdFactory,
  options: { sourceOnly?: boolean } = {},
): Claim[] {
  const mapped = drafts.map((draft) =>
    mapClaim(draft, prompt, `${prefix}-${idFactory()}`, options),
  );
  const nonMissing = mapped.filter((claim) => claim.status !== "missing");
  return nonMissing.length > 0 ? nonMissing : [missingClaim(`${prefix}-${idFactory()}`)];
}

function mapAction(
  draft: ModelActionDraft,
  prompt: string,
  idFactory: IdFactory,
): DraftAction {
  const actionId = `action-${idFactory()}`;
  const title = containsUnsupportedNumber(draft.title, prompt)
    ? "Define the next implementation step"
    : draft.title.trim();
  const owner = mapClaimOrMissing(draft.owner, prompt, `${actionId}-owner`, {
    sourceOnly: true,
  });
  return {
    sourceItemId: actionId,
    title: title || "Define the next implementation step",
    summary: [mapClaimOrMissing(draft.summary, prompt, `${actionId}-summary`)],
    owner: owner.status === "missing" ? null : owner,
  };
}

function supportedMetricValue(
  value: number | null,
  quote: string,
  prompt: string,
): number | null {
  if (value === null || !quoteIsSupported(quote, prompt)) return null;
  const normalizedQuoteTokens = numericTokens(quote).map((token) => token.replace(/[% ,]/g, ""));
  return normalizedQuoteTokens.includes(String(value)) ? value : null;
}

export function materializeModelDecisionReport(
  draft: ModelDecisionReportDraft,
  prompt: string,
  options: { idFactory?: IdFactory; workspaceName?: string } = {},
): DecisionReportGeneration {
  const idFactory = options.idFactory ?? randomUUID;
  const report: DecisionReportV1 = {
    schemaVersion: 1,
    title: draft.title.trim() || "Decision Report draft",
    decision: {
      decision: [mapClaimOrMissing(draft.decision.decision, prompt, `decision-${idFactory()}`)],
      background: [mapClaimOrMissing(draft.decision.background, prompt, `background-${idFactory()}`)],
      problem: [mapClaimOrMissing(draft.decision.problem, prompt, `problem-${idFactory()}`)],
    },
    supportingEvidence: {
      factors: mapClaimArray(draft.supportingEvidence.factors, prompt, "factor", idFactory),
      metricMechanism: [
        mapClaimOrMissing(
          draft.supportingEvidence.metricMechanism,
          prompt,
          `mechanism-${idFactory()}`,
        ),
      ],
    },
    implementation: {
      actionPlanSummary: [
        mapClaimOrMissing(
          draft.implementation.actionPlanSummary,
          prompt,
          `action-summary-${idFactory()}`,
        ),
      ],
      actions: draft.implementation.actions
        .slice(0, 3)
        .map((action) => mapAction(action, prompt, idFactory)),
      customers: mapClaimArray(draft.implementation.customers, prompt, "customer", idFactory, {
        sourceOnly: true,
      }),
      stakeholders: mapClaimArray(
        draft.implementation.stakeholders,
        prompt,
        "stakeholder",
        idFactory,
        { sourceOnly: true },
      ),
      assetIds: [],
      governance: {
        dataClassification:
          !draft.implementation.governance ||
          draft.implementation.governance.dataClassification === "unspecified"
            ? null
            : draft.implementation.governance.dataClassification,
        allowedDataSources: mapClaimArray(
          draft.implementation.governance?.allowedDataSources ?? [],
          prompt,
          "data-source",
          idFactory,
          { sourceOnly: true },
        ),
        approvedModelNotes: mapClaimArray(
          draft.implementation.governance?.approvedModelNotes ?? [],
          prompt,
          "model-note",
          idFactory,
          { sourceOnly: true },
        ),
      },
    },
  };

  const validation = validateDecisionReport(report);
  if (!validation.success) {
    throw new Error(`Materialized Decision Report is invalid: ${validation.errors.join("; ")}`);
  }

  const baselinePct = supportedMetricValue(
    draft.metric.baselinePct,
    draft.metric.baselineEvidenceQuote,
    prompt,
  );
  const predictedPct = supportedMetricValue(
    draft.metric.predictedPct,
    draft.metric.predictedEvidenceQuote,
    prompt,
  );

  return {
    report,
    workspaceName: options.workspaceName ?? "Orbit",
    projectName: draft.projectName.trim() || "New project",
    metricProjection: {
      metricName: draft.metric.name.trim() || "Core metric needs confirmation",
      definition: draft.metric.definition.trim() || "Define how this metric is calculated.",
      baselinePct,
      predictedPct,
      baselineLabel: "Supplied baseline",
      predictionLabel: "Supplied prediction",
      evidenceState:
        baselinePct === null && predictedPct === null ? "missing" : "prompt_supplied",
    },
  };
}

export function createSafeFallbackReport(
  prompt: string,
  options: { idFactory?: IdFactory; workspaceName?: string } = {},
): DecisionReportGeneration {
  const idFactory = options.idFactory ?? randomUUID;
  const missing = (prefix: string) => missingClaim(`${prefix}-${idFactory()}`);
  const report: DecisionReportV1 = {
    schemaVersion: 1,
    title: "Decision Report draft",
    decision: {
      decision: [missing("decision")],
      background: [
        {
          id: `background-${idFactory()}`,
          text: prompt.trim(),
          status: "sourced",
          sourceChunkIds: [INITIAL_PROMPT_SOURCE_ID],
        },
      ],
      problem: [missing("problem")],
    },
    supportingEvidence: {
      factors: [missing("factor")],
      metricMechanism: [missing("mechanism")],
    },
    implementation: {
      actionPlanSummary: [missing("action-summary")],
      actions: [],
      customers: [missing("customer")],
      stakeholders: [missing("stakeholder")],
      assetIds: [],
      governance: {
        dataClassification: null,
        allowedDataSources: [missing("data-source")],
        approvedModelNotes: [missing("model-note")],
      },
    },
  };

  return {
    report,
    workspaceName: options.workspaceName ?? "Orbit",
    projectName: "New project",
    metricProjection: {
      metricName: "Core metric needs confirmation",
      definition: "Define the metric and how it is calculated.",
      baselinePct: null,
      predictedPct: null,
      baselineLabel: "Baseline",
      predictionLabel: "Prediction",
      evidenceState: "missing",
    },
  };
}
