import type { ReportSourceSummary } from "./sources/types.ts";

export const CLAIM_STATUSES = [
  "sourced",
  "inferred",
  "suggested",
  "missing",
  "user_confirmed",
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export type Claim = {
  id: string;
  text: string;
  status: ClaimStatus;
  sourceChunkIds: string[];
};

export type DraftAction = {
  sourceItemId: string;
  title: string;
  summary: Claim[];
  owner: Claim | null;
  /** Optional execution metadata lives in the immutable report snapshot. */
  priority?: 1 | 2 | 3;
  tags?: string[];
  skills?: string[];
  estimatedTime?: string;
  estimatedCost?: string;
};

export const MAX_DECISION_REPORT_ACTIONS = 25;

export type DecisionReportActivationDraft = {
  confirmedMetricId: string | null;
  selectedActionSourceItemIds: string[];
  primaryLeverActionSourceItemId: string | null;
  prediction: {
    direction: "POSITIVE" | "NEGATIVE";
    magnitudePctMean: number | null;
    resolutionDate: string | null;
  };
};

export function emptyDecisionReportActivationDraft(): DecisionReportActivationDraft {
  return {
    confirmedMetricId: null,
    selectedActionSourceItemIds: [],
    primaryLeverActionSourceItemId: null,
    prediction: {
      direction: "POSITIVE",
      magnitudePctMean: null,
      resolutionDate: null,
    },
  };
}

export type DecisionReportV1 = {
  /** Version 1 is readable legacy data; every newly generated or edited report is version 2. */
  schemaVersion: 1 | 2;
  title: string;
  /** Partial pre-activation intent. Canonical rows are created only by activation. */
  activationDraft?: DecisionReportActivationDraft;
  /** Required for v2. Bounded provenance lives in the same RLS-protected snapshot. */
  sourceSummaries?: ReportSourceSummary[];
  decision: {
    decision: Claim[];
    background: Claim[];
    problem: Claim[];
  };
  supportingEvidence: {
    factors: Claim[];
    metricMechanism: Claim[];
  };
  implementation: {
    actionPlanSummary: Claim[];
    actions: DraftAction[];
    customers: Claim[];
    stakeholders: Claim[];
    assetIds: string[];
    governance: {
      dataClassification: "private" | "organization" | "public" | null;
      allowedDataSources: Claim[];
      approvedModelNotes: Claim[];
    };
  };
};

export type MetricProjection = {
  metricName: string;
  definition: string;
  baselinePct: number | null;
  predictedPct: number | null;
  baselineLabel: string;
  predictionLabel: string;
  evidenceState: "illustrative_assumption" | "prompt_supplied" | "missing";
};

export type DecisionReportGoldenExample = {
  projectName: string;
  workspaceName: string;
  initialPrompt: string;
  report: DecisionReportV1;
  metricProjection: MetricProjection;
};

export type ValidationResult =
  | { success: true; data: DecisionReportV1 }
  | { success: false; errors: string[] };

export type MetricProjectionValidationResult =
  | { success: true; data: MetricProjection }
  | { success: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateClaim(value: unknown, path: string, errors: string[]): value is Claim {
  if (!isRecord(value)) {
    errors.push(`${path} must be a claim object`);
    return false;
  }

  if (typeof value.id !== "string" || value.id.trim() === "") {
    errors.push(`${path}.id must be a non-empty string`);
  }
  if (typeof value.text !== "string") {
    errors.push(`${path}.text must be a string`);
  }
  if (!CLAIM_STATUSES.includes(value.status as ClaimStatus)) {
    errors.push(`${path}.status is invalid`);
  }
  if (!Array.isArray(value.sourceChunkIds) || value.sourceChunkIds.some((id) => typeof id !== "string")) {
    errors.push(`${path}.sourceChunkIds must be a string array`);
  }

  if (value.status === "sourced" && Array.isArray(value.sourceChunkIds) && value.sourceChunkIds.length === 0) {
    errors.push(`${path} is sourced but has no source chunk`);
  }
  if (value.status === "missing" && typeof value.text === "string" && value.text.trim() !== "") {
    errors.push(`${path} is missing but contains text`);
  }
  if (value.status !== "sourced" && Array.isArray(value.sourceChunkIds) && value.sourceChunkIds.length > 0) {
    errors.push(`${path} has source chunks but is not sourced`);
  }

  return errors.length === 0;
}

function validateClaimArray(
  value: unknown,
  path: string,
  errors: string[],
  maxItems?: number,
): value is Claim[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return false;
  }
  if (maxItems !== undefined && value.length > maxItems) {
    errors.push(`${path} cannot exceed ${maxItems} items`);
  }
  value.forEach((claim, index) => validateClaim(claim, `${path}[${index}]`, errors));
  return true;
}

function validateAction(value: unknown, path: string, errors: string[]): value is DraftAction {
  if (!isRecord(value)) {
    errors.push(`${path} must be an action object`);
    return false;
  }

  if (typeof value.sourceItemId !== "string" || value.sourceItemId.trim() === "") {
    errors.push(`${path}.sourceItemId must be a non-empty string`);
  }
  if (typeof value.title !== "string" || value.title.trim() === "") {
    errors.push(`${path}.title must be a non-empty string`);
  }
  validateClaimArray(value.summary, `${path}.summary`, errors);
  if (value.owner !== null) validateClaim(value.owner, `${path}.owner`, errors);

  if (
    value.priority !== undefined &&
    (!Number.isInteger(value.priority) || ![1, 2, 3].includes(value.priority as number))
  ) {
    errors.push(`${path}.priority must be 1, 2, or 3`);
  }
  for (const field of ["tags", "skills"] as const) {
    const entries = value[field];
    if (
      entries !== undefined &&
      (!Array.isArray(entries) ||
        entries.length > 5 ||
        entries.some(
          (entry) =>
            typeof entry !== "string" ||
            entry.trim() === "" ||
            entry.length > 40 ||
            /[\u0000-\u001f\u007f]/.test(entry),
        ))
    ) {
      errors.push(`${path}.${field} must contain at most five safe labels`);
    }
  }
  for (const field of ["estimatedTime", "estimatedCost"] as const) {
    const estimate = value[field];
    if (
      estimate !== undefined &&
      (typeof estimate !== "string" ||
        estimate.length > 80 ||
        /[\u0000-\u001f\u007f]/.test(estimate))
    ) {
      errors.push(`${path}.${field} must be a safe string up to 80 characters`);
    }
  }
  return true;
}

function validateActivationDraft(
  value: unknown,
  actionSourceItemIds: Set<string>,
  errors: string[],
): value is DecisionReportActivationDraft {
  if (!isRecord(value)) {
    errors.push("activationDraft must be an object");
    return false;
  }

  if (
    value.confirmedMetricId !== null &&
    (typeof value.confirmedMetricId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value.confirmedMetricId,
      ))
  ) {
    errors.push("activationDraft.confirmedMetricId must be null or a UUID");
  }

  const selected = value.selectedActionSourceItemIds;
  if (
    !Array.isArray(selected) ||
    selected.length > 3 ||
    selected.some(
      (sourceItemId) =>
        typeof sourceItemId !== "string" ||
        sourceItemId.trim() === "" ||
        !actionSourceItemIds.has(sourceItemId),
    ) ||
    new Set(selected).size !== selected.length
  ) {
    errors.push(
      "activationDraft.selectedActionSourceItemIds must contain up to three unique report action IDs",
    );
  }

  if (
    value.primaryLeverActionSourceItemId !== null &&
    (typeof value.primaryLeverActionSourceItemId !== "string" ||
      !Array.isArray(selected) ||
      !selected.includes(value.primaryLeverActionSourceItemId))
  ) {
    errors.push(
      "activationDraft.primaryLeverActionSourceItemId must be null or a selected action ID",
    );
  }

  const prediction = value.prediction;
  if (!isRecord(prediction)) {
    errors.push("activationDraft.prediction must be an object");
    return false;
  }
  if (!['POSITIVE', 'NEGATIVE'].includes(prediction.direction as string)) {
    errors.push("activationDraft.prediction.direction is invalid");
  }
  if (
    prediction.magnitudePctMean !== null &&
    (typeof prediction.magnitudePctMean !== "number" ||
      !Number.isFinite(prediction.magnitudePctMean) ||
      prediction.magnitudePctMean <= 0)
  ) {
    errors.push(
      "activationDraft.prediction.magnitudePctMean must be null or a positive finite number",
    );
  }
  if (prediction.resolutionDate !== null) {
    const date = typeof prediction.resolutionDate === "string"
      ? new Date(`${prediction.resolutionDate}T00:00:00Z`)
      : null;
    if (
      typeof prediction.resolutionDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(prediction.resolutionDate) ||
      !date ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== prediction.resolutionDate
    ) {
      errors.push(
        "activationDraft.prediction.resolutionDate must be null or a valid YYYY-MM-DD date",
      );
    }
  }
  return true;
}

function validateSourceSummaries(
  value: unknown,
  errors: string[],
): value is ReportSourceSummary[] {
  if (!Array.isArray(value) || value.length > 3) {
    errors.push("sourceSummaries must contain zero to three sources");
    return false;
  }

  const sourceIds = new Set<string>();
  const chunkIds = new Set<string>();
  value.forEach((source, sourceIndex) => {
    const path = `sourceSummaries[${sourceIndex}]`;
    if (!isRecord(source)) {
      errors.push(`${path} must be a source object`);
      return;
    }
    if (
      typeof source.sourceId !== "string" ||
      source.sourceId.trim() === "" ||
      source.sourceId.length > 120 ||
      sourceIds.has(source.sourceId)
    ) {
      errors.push(`${path}.sourceId must be a unique non-empty ID`);
    } else {
      sourceIds.add(source.sourceId);
    }
    if (!["brief", "url", "pdf"].includes(source.kind as string)) {
      errors.push(`${path}.kind is invalid`);
    }
    if (
      typeof source.label !== "string" ||
      source.label.trim() === "" ||
      source.label.length > 160 ||
      /[\u0000-\u001f\u007f]/.test(source.label)
    ) {
      errors.push(`${path}.label must be between 1 and 160 safe characters`);
    }
    if (
      source.locator !== null &&
      (typeof source.locator !== "string" ||
        source.locator.length > 2_048 ||
        /[\u0000-\u001f\u007f]/.test(source.locator))
    ) {
      errors.push(`${path}.locator must be null or a bounded safe string`);
    }
    if (
      source.finalOrigin !== null &&
      (typeof source.finalOrigin !== "string" ||
        source.finalOrigin.length > 255 ||
        /[\u0000-\u001f\u007f]/.test(source.finalOrigin) ||
        (() => {
          try {
            const parsed = new URL(source.finalOrigin);
            return parsed.protocol !== "https:" || parsed.origin !== source.finalOrigin;
          } catch {
            return true;
          }
        })())
    ) {
      errors.push(`${path}.finalOrigin must be null or a canonical HTTPS origin`);
    }
    if ((source.kind === "url") !== (typeof source.finalOrigin === "string")) {
      errors.push(`${path}.finalOrigin must be present only for URL sources`);
    }
    if (
      source.pageCount !== null &&
      (typeof source.pageCount !== "number" ||
        !Number.isInteger(source.pageCount) ||
        source.pageCount < 1 ||
        source.pageCount > 40)
    ) {
      errors.push(`${path}.pageCount must be null or an integer from 1 to 40`);
    }
    if (
      typeof source.retrievedAt !== "string" ||
      Number.isNaN(Date.parse(source.retrievedAt)) ||
      source.retrievedAt.length > 40
    ) {
      errors.push(`${path}.retrievedAt must be an ISO timestamp`);
    }
    if (typeof source.contentSha256 !== "string" || !/^[0-9a-f]{64}$/.test(source.contentSha256)) {
      errors.push(`${path}.contentSha256 must be a lowercase SHA-256 digest`);
    }
    if (!Array.isArray(source.chunks) || source.chunks.length < 1 || source.chunks.length > 64) {
      errors.push(`${path}.chunks must contain one to 64 chunk references`);
      return;
    }
    source.chunks.forEach((chunk, chunkIndex) => {
      const chunkPath = `${path}.chunks[${chunkIndex}]`;
      if (!isRecord(chunk)) {
        errors.push(`${chunkPath} must be a chunk reference`);
        return;
      }
      if (
        typeof chunk.chunkId !== "string" ||
        chunk.chunkId.trim() === "" ||
        chunk.chunkId.length > 120 ||
        chunkIds.has(chunk.chunkId)
      ) {
        errors.push(`${chunkPath}.chunkId must be a globally unique non-empty ID`);
      } else {
        chunkIds.add(chunk.chunkId);
      }
      if (
        chunk.locator !== null &&
        (typeof chunk.locator !== "string" ||
          chunk.locator.length > 2_048 ||
          /[\u0000-\u001f\u007f]/.test(chunk.locator))
      ) {
        errors.push(`${chunkPath}.locator must be null or a bounded safe string`);
      }
      if (
        typeof chunk.text !== "string" ||
        chunk.text.trim() === "" ||
        chunk.text.length > 2_000 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(chunk.text)
      ) {
        errors.push(`${chunkPath}.text must contain one to 2,000 safe characters`);
      }
      if (typeof chunk.contentSha256 !== "string" || !/^[0-9a-f]{64}$/.test(chunk.contentSha256)) {
        errors.push(`${chunkPath}.contentSha256 must be a lowercase SHA-256 digest`);
      }
    });
  });
  return true;
}

export function validateDecisionReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { success: false, errors: ["report must be an object"] };

  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) {
    errors.push("schemaVersion must be 1 or 2");
  }
  if (typeof value.title !== "string" || value.title.trim() === "") {
    errors.push("title must be a non-empty string");
  }

  let persistedChunkIds: Set<string> | null = null;
  if (value.schemaVersion === 2 && value.sourceSummaries === undefined) {
    errors.push("sourceSummaries is required for schemaVersion 2");
  } else if (value.schemaVersion === 2) {
    if (validateSourceSummaries(value.sourceSummaries, errors)) {
      persistedChunkIds = new Set(
        value.sourceSummaries.flatMap((source) =>
          source.chunks.map((chunk) => chunk.chunkId),
        ),
      );
    }
  }

  const decision = value.decision;
  if (!isRecord(decision)) {
    errors.push("decision must be an object");
  } else {
    validateClaimArray(decision.decision, "decision.decision", errors);
    validateClaimArray(decision.background, "decision.background", errors);
    validateClaimArray(decision.problem, "decision.problem", errors);
  }

  const evidence = value.supportingEvidence;
  if (!isRecord(evidence)) {
    errors.push("supportingEvidence must be an object");
  } else {
    validateClaimArray(evidence.factors, "supportingEvidence.factors", errors, 3);
    validateClaimArray(evidence.metricMechanism, "supportingEvidence.metricMechanism", errors);
  }

  const implementation = value.implementation;
  const actionSourceItemIds = new Set<string>();
  if (!isRecord(implementation)) {
    errors.push("implementation must be an object");
  } else {
    validateClaimArray(implementation.actionPlanSummary, "implementation.actionPlanSummary", errors);
    validateClaimArray(implementation.customers, "implementation.customers", errors);
    validateClaimArray(implementation.stakeholders, "implementation.stakeholders", errors);

    if (!Array.isArray(implementation.actions)) {
      errors.push("implementation.actions must be an array");
    } else {
      if (implementation.actions.length > MAX_DECISION_REPORT_ACTIONS) {
        errors.push(
          `implementation.actions cannot exceed ${MAX_DECISION_REPORT_ACTIONS} items`,
        );
      }
      implementation.actions.forEach((action, index) =>
        {
          validateAction(action, `implementation.actions[${index}]`, errors);
          if (isRecord(action) && typeof action.sourceItemId === "string") {
            actionSourceItemIds.add(action.sourceItemId);
          }
        },
      );
    }

    if (!Array.isArray(implementation.assetIds) || implementation.assetIds.length > 1 || implementation.assetIds.some((id) => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id))) {
      errors.push("implementation.assetIds must contain at most one UUID");
    }

    const governance = implementation.governance;
    if (!isRecord(governance)) {
      errors.push("implementation.governance must be an object");
    } else {
      if (![null, "private", "organization", "public"].includes(
        governance.dataClassification as null | string,
      )) {
        errors.push("implementation.governance.dataClassification is invalid");
      }
      validateClaimArray(
        governance.allowedDataSources,
        "implementation.governance.allowedDataSources",
        errors,
      );
      validateClaimArray(
        governance.approvedModelNotes,
        "implementation.governance.approvedModelNotes",
        errors,
      );
    }
  }

  if (value.activationDraft !== undefined) {
    validateActivationDraft(value.activationDraft, actionSourceItemIds, errors);
  }

  if (value.schemaVersion === 2 && persistedChunkIds) {
    const claims = [
      ...(isRecord(decision) && Array.isArray(decision.decision) ? decision.decision : []),
      ...(isRecord(decision) && Array.isArray(decision.background) ? decision.background : []),
      ...(isRecord(decision) && Array.isArray(decision.problem) ? decision.problem : []),
      ...(isRecord(evidence) && Array.isArray(evidence.factors) ? evidence.factors : []),
      ...(isRecord(evidence) && Array.isArray(evidence.metricMechanism)
        ? evidence.metricMechanism
        : []),
      ...(isRecord(implementation) && Array.isArray(implementation.actionPlanSummary)
        ? implementation.actionPlanSummary
        : []),
      ...(isRecord(implementation) && Array.isArray(implementation.customers)
        ? implementation.customers
        : []),
      ...(isRecord(implementation) && Array.isArray(implementation.stakeholders)
        ? implementation.stakeholders
        : []),
      ...(isRecord(implementation) && Array.isArray(implementation.actions)
        ? implementation.actions.flatMap((action) =>
            isRecord(action)
              ? [
                  ...(Array.isArray(action.summary) ? action.summary : []),
                  ...(action.owner === null || action.owner === undefined ? [] : [action.owner]),
                ]
              : [],
          )
        : []),
      ...(isRecord(implementation) && isRecord(implementation.governance)
        ? [
            ...(Array.isArray(implementation.governance.allowedDataSources)
              ? implementation.governance.allowedDataSources
              : []),
            ...(Array.isArray(implementation.governance.approvedModelNotes)
              ? implementation.governance.approvedModelNotes
              : []),
          ]
        : []),
    ];
    for (const claim of claims) {
      if (!isRecord(claim) || !Array.isArray(claim.sourceChunkIds)) continue;
      if (claim.sourceChunkIds.some((chunkId) => !persistedChunkIds.has(String(chunkId)))) {
        errors.push("sourced claims must reference a persisted source chunk");
        break;
      }
    }
  }

  return errors.length === 0
    ? { success: true, data: value as DecisionReportV1 }
    : { success: false, errors };
}

export function validateMetricProjection(
  value: unknown,
): MetricProjectionValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { success: false, errors: ["metric projection must be an object"] };
  }

  for (const field of [
    "metricName",
    "definition",
    "baselineLabel",
    "predictionLabel",
  ] as const) {
    if (typeof value[field] !== "string" || value[field].trim() === "") {
      errors.push(`${field} must be a non-empty string`);
    }
  }

  for (const field of ["baselinePct", "predictedPct"] as const) {
    const numeric = value[field];
    if (
      numeric !== null &&
      (typeof numeric !== "number" || !Number.isFinite(numeric) || numeric < 0 || numeric > 100)
    ) {
      errors.push(`${field} must be null or a finite percentage from 0 to 100`);
    }
  }

  if (
    !["illustrative_assumption", "prompt_supplied", "missing"].includes(
      value.evidenceState as MetricProjection["evidenceState"],
    )
  ) {
    errors.push("evidenceState is invalid");
  }

  return errors.length === 0
    ? { success: true, data: value as MetricProjection }
    : { success: false, errors };
}

export function cloneDecisionReport(report: DecisionReportV1): DecisionReportV1 {
  return structuredClone(report);
}

/**
 * A legacy editable snapshot has no trustworthy durable chunk record. Preserve
 * its text, but remove the sourced assertion before it can be saved as v2.
 * Active v1 reports are never rewritten and remain readable as historical data.
 */
export function upgradeLegacyDecisionReportForEditing(
  report: DecisionReportV1,
): DecisionReportV1 {
  const upgraded = cloneDecisionReport(report);
  if (upgraded.schemaVersion === 2) return upgraded;

  upgraded.schemaVersion = 2;
  upgraded.sourceSummaries = [];
  const claims: Claim[] = [
    ...upgraded.decision.decision,
    ...upgraded.decision.background,
    ...upgraded.decision.problem,
    ...upgraded.supportingEvidence.factors,
    ...upgraded.supportingEvidence.metricMechanism,
    ...upgraded.implementation.actionPlanSummary,
    ...upgraded.implementation.customers,
    ...upgraded.implementation.stakeholders,
    ...upgraded.implementation.governance.allowedDataSources,
    ...upgraded.implementation.governance.approvedModelNotes,
    ...upgraded.implementation.actions.flatMap((action) => [
      ...action.summary,
      ...(action.owner ? [action.owner] : []),
    ]),
  ];
  for (const claim of claims) {
    if (claim.status !== "sourced") continue;
    claim.status = claim.text.trim() ? "user_confirmed" : "missing";
    claim.sourceChunkIds = [];
  }
  return upgraded;
}
