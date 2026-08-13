import { randomUUID } from "node:crypto";
import type { JSONSchema7 } from "ai";

import type {
  Claim,
  DecisionReportV1,
  DraftAction,
  MetricProjection,
} from "./schema.ts";
import {
  MAX_DECISION_REPORT_ACTIONS,
  validateDecisionReport,
} from "./schema.ts";
import {
  INITIAL_PROMPT_SOURCE_ID,
  type ReportSourceChunk,
  type ReportSourceCorpus,
  type ReportSourceSummary,
} from "./sources/types.ts";
import { createReportSourceCorpus } from "./sources/corpus.ts";

export const DECISION_REPORT_PROMPT_MIN_CHARS = 20;
export const DECISION_REPORT_PROMPT_MAX_CHARS = 6_000;
export { INITIAL_PROMPT_SOURCE_ID };

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
  evidenceSourceChunkId: string;
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
    baselineSourceChunkId: string;
    predictedPct: number | null;
    predictedEvidenceQuote: string;
    predictedSourceChunkId: string;
  };
};

export type DecisionReportGeneration = {
  report: DecisionReportV1;
  metricProjection: MetricProjection;
  workspaceName: string;
  projectName: string;
  sourceSummaries: ReportSourceSummary[];
};

type IdFactory = () => string;

const claimDraftSchema: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: { type: "string", maxLength: 500 },
    kind: { type: "string", enum: [...MODEL_CLAIM_KINDS] },
    evidenceQuote: { type: "string", maxLength: 500 },
    evidenceSourceChunkId: { type: "string", maxLength: 120 },
  },
  required: ["text", "kind", "evidenceQuote", "evidenceSourceChunkId"],
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
          maxItems: MAX_DECISION_REPORT_ACTIONS,
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
        baselineSourceChunkId: { type: "string", maxLength: 120 },
        predictedPct: { type: ["number", "null"], minimum: 0, maximum: 100 },
        predictedEvidenceQuote: { type: "string", maxLength: 1_500 },
        predictedSourceChunkId: { type: "string", maxLength: 120 },
      },
      required: [
        "name",
        "definition",
        "baselinePct",
        "baselineEvidenceQuote",
        "baselineSourceChunkId",
        "predictedPct",
        "predictedEvidenceQuote",
        "predictedSourceChunkId",
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
    typeof value.evidenceQuote === "string" &&
    typeof value.evidenceSourceChunkId === "string"
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
    implementation.actions.length > MAX_DECISION_REPORT_ACTIONS ||
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
    typeof metric.baselineSourceChunkId !== "string" ||
    !isOptionalPercentage(metric.predictedPct) ||
    typeof metric.predictedEvidenceQuote !== "string" ||
    typeof metric.predictedSourceChunkId !== "string"
  ) {
    return { success: false, error: new Error("Generated report does not match the generation contract.") };
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

function numericTokens(value: string): string[] {
  return value.match(/\d+(?:[.,]\d+)?%?/g) ?? [];
}

function asCorpus(value: string | ReportSourceCorpus): ReportSourceCorpus {
  return typeof value === "string" ? createReportSourceCorpus(value) : value;
}

function evidenceChunk(
  quote: string,
  chunkId: string,
  corpus: ReportSourceCorpus,
): ReportSourceChunk | null {
  const candidate = quote.trim();
  if (candidate.length < 8 || !chunkId) return null;
  const chunk = corpus.chunks.find((item) => item.chunkId === chunkId);
  return chunk && chunk.text.includes(candidate) ? chunk : null;
}

function containsUnsupportedNumber(text: string, corpus: ReportSourceCorpus): boolean {
  const corpusTokens = new Set(
    corpus.chunks
      .flatMap((chunk) => numericTokens(chunk.text))
      .map((token) => token.replace(/,/g, "")),
  );
  return numericTokens(text).some((token) => !corpusTokens.has(token.replace(/,/g, "")));
}

function missingClaim(id: string): Claim {
  return { id, text: "", status: "missing", sourceChunkIds: [] };
}

function mapClaim(
  draft: ModelClaimDraft,
  corpus: ReportSourceCorpus,
  id: string,
  options: { sourceOnly?: boolean } = {},
): Claim {
  const text = draft.text.trim();
  if (draft.kind === "missing" || text === "") return missingClaim(id);

  const sourceChunk =
    draft.kind === "supported"
      ? evidenceChunk(draft.evidenceQuote, draft.evidenceSourceChunkId, corpus)
      : null;
  if (containsUnsupportedNumber(text, corpus)) return missingClaim(id);
  if (options.sourceOnly && !sourceChunk) return missingClaim(id);

  if (sourceChunk) {
    return {
      id,
      text,
      status: "sourced",
      sourceChunkIds: [sourceChunk.chunkId],
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
  corpus: ReportSourceCorpus,
  id: string,
  options: { sourceOnly?: boolean } = {},
): Claim {
  return draft === null ? missingClaim(id) : mapClaim(draft, corpus, id, options);
}

function mapClaimArray(
  drafts: ModelClaimDraft[],
  corpus: ReportSourceCorpus,
  prefix: string,
  idFactory: IdFactory,
  options: { sourceOnly?: boolean } = {},
): Claim[] {
  const mapped = drafts.map((draft) =>
    mapClaim(draft, corpus, `${prefix}-${idFactory()}`, options),
  );
  const nonMissing = mapped.filter((claim) => claim.status !== "missing");
  return nonMissing.length > 0 ? nonMissing : [missingClaim(`${prefix}-${idFactory()}`)];
}

function mapAction(
  draft: ModelActionDraft,
  corpus: ReportSourceCorpus,
  idFactory: IdFactory,
  index: number,
): DraftAction {
  const actionId = `action-${idFactory()}`;
  const title = containsUnsupportedNumber(draft.title, corpus)
    ? "Define the next implementation step"
    : draft.title.trim();
  const owner = mapClaimOrMissing(draft.owner, corpus, `${actionId}-owner`, {
    sourceOnly: true,
  });
  return {
    sourceItemId: actionId,
    title: title || "Define the next implementation step",
    summary: [mapClaimOrMissing(draft.summary, corpus, `${actionId}-summary`)],
    owner: owner.status === "missing" ? null : owner,
    priority: index === 0 ? 3 : index === 1 ? 2 : 1,
    tags: [],
    skills: [],
    estimatedTime: "",
    estimatedCost: "",
  };
}

function supportedMetricValue(
  value: number | null,
  quote: string,
  sourceChunkId: string,
  corpus: ReportSourceCorpus,
): number | null {
  if (value === null || !evidenceChunk(quote, sourceChunkId, corpus)) return null;
  const normalizedQuoteTokens = numericTokens(quote).map((token) => token.replace(/[% ,]/g, ""));
  return normalizedQuoteTokens.includes(String(value)) ? value : null;
}

export function materializeModelDecisionReport(
  draft: ModelDecisionReportDraft,
  sourceInput: string | ReportSourceCorpus,
  options: { idFactory?: IdFactory; workspaceName?: string } = {},
): DecisionReportGeneration {
  const idFactory = options.idFactory ?? randomUUID;
  const corpus = asCorpus(sourceInput);
  const sourceSummaries = corpus.sources.map((source) => ({
    ...source,
    chunks: source.chunks.map((chunk) => ({ ...chunk })),
  }));
  const report: DecisionReportV1 = {
    schemaVersion: 2,
    title: draft.title.trim() || "Decision Report draft",
    sourceSummaries,
    decision: {
      decision: [mapClaimOrMissing(draft.decision.decision, corpus, `decision-${idFactory()}`)],
      background: [mapClaimOrMissing(draft.decision.background, corpus, `background-${idFactory()}`)],
      problem: [mapClaimOrMissing(draft.decision.problem, corpus, `problem-${idFactory()}`)],
    },
    supportingEvidence: {
      factors: mapClaimArray(draft.supportingEvidence.factors, corpus, "factor", idFactory),
      metricMechanism: [
        mapClaimOrMissing(
          draft.supportingEvidence.metricMechanism,
          corpus,
          `mechanism-${idFactory()}`,
        ),
      ],
    },
    implementation: {
      actionPlanSummary: [
        mapClaimOrMissing(
          draft.implementation.actionPlanSummary,
          corpus,
          `action-summary-${idFactory()}`,
        ),
      ],
      actions: draft.implementation.actions
        .slice(0, MAX_DECISION_REPORT_ACTIONS)
        .map((action, index) => mapAction(action, corpus, idFactory, index)),
      customers: mapClaimArray(draft.implementation.customers, corpus, "customer", idFactory, {
        sourceOnly: true,
      }),
      stakeholders: mapClaimArray(
        draft.implementation.stakeholders,
        corpus,
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
          corpus,
          "data-source",
          idFactory,
          { sourceOnly: true },
        ),
        approvedModelNotes: mapClaimArray(
          draft.implementation.governance?.approvedModelNotes ?? [],
          corpus,
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
    draft.metric.baselineSourceChunkId,
    corpus,
  );
  const predictedPct = supportedMetricValue(
    draft.metric.predictedPct,
    draft.metric.predictedEvidenceQuote,
    draft.metric.predictedSourceChunkId,
    corpus,
  );

  return {
    report,
    workspaceName: options.workspaceName ?? "Orbit",
    projectName: draft.projectName.trim() || "New project",
    sourceSummaries,
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
  sourceInput: string | ReportSourceCorpus,
  options: { idFactory?: IdFactory; workspaceName?: string } = {},
): DecisionReportGeneration {
  const idFactory = options.idFactory ?? randomUUID;
  const corpus = asCorpus(sourceInput);
  const promptChunkIds = corpus.chunks
    .filter((chunk) => chunk.sourceId === INITIAL_PROMPT_SOURCE_ID)
    .map((chunk) => chunk.chunkId);
  const sourceSummaries = corpus.sources.map((source) => ({
    ...source,
    chunks: source.chunks.map((chunk) => ({ ...chunk })),
  }));
  const missing = (prefix: string) => missingClaim(`${prefix}-${idFactory()}`);
  const report: DecisionReportV1 = {
    schemaVersion: 2,
    title: "Decision Report draft",
    sourceSummaries,
    decision: {
      decision: [missing("decision")],
      background: [
        {
          id: `background-${idFactory()}`,
          text: corpus.brief.trim(),
          status: "sourced",
          sourceChunkIds: promptChunkIds,
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
    sourceSummaries,
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
