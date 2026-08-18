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

export const MAX_PORTABLE_RICH_TEXT_NODES = 256;
export const MAX_PORTABLE_RICH_TEXT_DEPTH = 8;
export const MAX_PORTABLE_RICH_TEXT_CHARACTERS = 20_000;
export const MAX_PORTABLE_RICH_TEXT_LINKS = 32;
export const MAX_PORTABLE_RICH_TEXT_URL_LENGTH = 2_048;
export const MAX_DECISION_REPORT_CLAIM_DOCUMENTS = 64;
export const MAX_DECISION_REPORT_PRESENTATION_BYTES = 96 * 1_024;

export type PortableRichTextMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "strike" }
  | { type: "underline" }
  | { type: "link"; attrs: { href: string } };

export type PortableRichTextTextNode = {
  type: "text";
  text: string;
  marks?: PortableRichTextMark[];
};

export type PortableRichTextHardBreakNode = {
  type: "hardBreak";
};

export type PortableRichTextInlineNode =
  | PortableRichTextTextNode
  | PortableRichTextHardBreakNode;

export type PortableRichTextParagraphNode = {
  type: "paragraph";
  content?: PortableRichTextInlineNode[];
};

export type PortableRichTextHeadingNode = {
  type: "heading";
  attrs: { level: 2 | 3 };
  content?: PortableRichTextInlineNode[];
};

export type PortableRichTextBulletListNode = {
  type: "bulletList";
  content: PortableRichTextListItemNode[];
};

export type PortableRichTextOrderedListNode = {
  type: "orderedList";
  content: PortableRichTextListItemNode[];
};

export type PortableRichTextBlockquoteNode = {
  type: "blockquote";
  content: PortableRichTextBlockNode[];
};

export type PortableRichTextListItemNode = {
  type: "listItem";
  content: PortableRichTextBlockNode[];
};

export type PortableRichTextBlockNode =
  | PortableRichTextParagraphNode
  | PortableRichTextHeadingNode
  | PortableRichTextBulletListNode
  | PortableRichTextOrderedListNode
  | PortableRichTextBlockquoteNode;

export type PortableRichTextNode =
  | PortableRichTextBlockNode
  | PortableRichTextListItemNode
  | PortableRichTextInlineNode;

export type PortableRichTextDocument = {
  type: "doc";
  content: PortableRichTextBlockNode[];
};

export type PortableRichTextValidationResult =
  | { success: true; data: PortableRichTextDocument }
  | { success: false; errors: string[] };

export type DecisionReportPresentationV1 = {
  version: 1;
  claimDocuments: Record<string, PortableRichTextDocument>;
};

function flattenPortableRichTextNode(node: PortableRichTextNode): string {
  switch (node.type) {
    case "text":
      return node.text;
    case "hardBreak":
      return "\n";
    case "paragraph":
    case "heading":
      return (node.content ?? []).map(flattenPortableRichTextNode).join("");
    case "bulletList":
    case "orderedList":
    case "listItem":
    case "blockquote":
      return node.content.map(flattenPortableRichTextNode).join("\n");
  }
}

/**
 * Derive the canonical plain-text claim value from the portable presentation.
 * Structural blocks are separated by one newline; marks never affect text.
 */
export function flattenPortableRichText(
  document: PortableRichTextDocument,
): string {
  return document.content.map(flattenPortableRichTextNode).join("\n");
}

/** Build a deterministic, formatting-free portable document for legacy text. */
export function portableRichTextFromPlainText(
  text: string,
): PortableRichTextDocument {
  return {
    type: "doc",
    content: text.split("\n").map((line) =>
      line === ""
        ? { type: "paragraph" as const }
        : {
            type: "paragraph" as const,
            content: [{ type: "text" as const, text: line }],
          },
    ),
  };
}

export type DraftAction = {
  sourceItemId: string;
  title: string;
  summary: Claim[];
  owner: Claim | null;
  /** Optional report-selected outcome metric for this action. */
  metricId?: string | null;
  /**
   * Optional monitoring context for supporting actions. This is plan metadata,
   * never an additional causal prediction and never independently scored.
   */
  monitoringExpectedDirection?: "INCREASE" | "DECREASE" | null;
  monitoringCheckDate?: string | null;
  /** Optional execution metadata lives in the immutable report snapshot. */
  priority?: 1 | 2 | 3;
  tags?: string[];
  skills?: string[];
  estimatedTime?: string;
  estimatedCost?: string;
};

export const MAX_DECISION_REPORT_ACTIONS = 25;
export const MAX_DECISION_REPORT_SELECTED_METRICS = 5;

export type DecisionReportActivationDraft = {
  confirmedMetricId: string | null;
  /**
   * Report metrics selected for this plan. Historical snapshots omit this field;
   * in that case the confirmed primary metric is the complete selected set.
   */
  selectedMetricIds?: string[];
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
    selectedMetricIds: [],
    selectedActionSourceItemIds: [],
    primaryLeverActionSourceItemId: null,
    prediction: {
      direction: "POSITIVE",
      magnitudePctMean: null,
      resolutionDate: null,
    },
  };
}

/** Resolve the selected report metrics without mutating legacy snapshots. */
export function resolveDecisionReportSelectedMetricIds(
  draft: DecisionReportActivationDraft,
): string[] {
  if (draft.selectedMetricIds !== undefined) {
    return [...draft.selectedMetricIds];
  }
  return draft.confirmedMetricId ? [draft.confirmedMetricId] : [];
}

export type DecisionReportV1 = {
  /** Version 1 is readable legacy data; every newly generated or edited report is version 2. */
  schemaVersion: 1 | 2;
  title: string;
  /** Optional rich presentation; Claim.text remains the authoritative semantic value. */
  presentation?: DecisionReportPresentationV1;
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

/** Resolve a stored claim document or synthesize a legacy plain-text fallback. */
export function getClaimPortableRichTextDocument(
  report: DecisionReportV1,
  claim: Claim,
): PortableRichTextDocument {
  const documents = report.presentation?.claimDocuments;
  const stored = documents && Object.prototype.hasOwnProperty.call(documents, claim.id)
    ? documents[claim.id]
    : undefined;
  return stored
    ? structuredClone(stored)
    : portableRichTextFromPlainText(claim.text);
}

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

const DECISION_REPORT_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PortableRichTextParentType =
  | "doc"
  | "paragraph"
  | "heading"
  | "bulletList"
  | "orderedList"
  | "listItem"
  | "blockquote";

type PortableRichTextValidationState = {
  nodes: number;
  characters: number;
  links: number;
};

const PORTABLE_RICH_TEXT_BLOCK_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "blockquote",
] as const;

function validateExactObjectKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: string[],
): boolean {
  const unsupported = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unsupported.length === 0) return true;
  errors.push(`${path} contains unsupported fields: ${unsupported.join(", ")}`);
  return false;
}

function portableNodeAllowedInParent(
  type: string,
  parent: PortableRichTextParentType,
): boolean {
  if (parent === "paragraph" || parent === "heading") {
    return type === "text" || type === "hardBreak";
  }
  if (parent === "bulletList" || parent === "orderedList") {
    return type === "listItem";
  }
  return PORTABLE_RICH_TEXT_BLOCK_TYPES.includes(
    type as (typeof PORTABLE_RICH_TEXT_BLOCK_TYPES)[number],
  );
}

function validatePortableRichTextMark(
  value: unknown,
  path: string,
  errors: string[],
  state: PortableRichTextValidationState,
): value is PortableRichTextMark {
  if (!isRecord(value) || typeof value.type !== "string") {
    errors.push(`${path} must be a supported rich-text mark`);
    return false;
  }

  if (["bold", "italic", "strike", "underline"].includes(value.type)) {
    return validateExactObjectKeys(value, ["type"], path, errors);
  }

  if (value.type !== "link") {
    errors.push(`${path}.type is unsupported`);
    return false;
  }

  let valid = validateExactObjectKeys(value, ["type", "attrs"], path, errors);
  state.links += 1;
  if (state.links > MAX_PORTABLE_RICH_TEXT_LINKS) {
    errors.push(
      `${path} exceeds the ${MAX_PORTABLE_RICH_TEXT_LINKS}-link document limit`,
    );
    valid = false;
  }
  if (!isRecord(value.attrs)) {
    errors.push(`${path}.attrs must contain only an href`);
    return false;
  }
  if (!validateExactObjectKeys(value.attrs, ["href"], `${path}.attrs`, errors)) {
    valid = false;
  }

  const href = value.attrs.href;
  if (
    typeof href !== "string" ||
    href.length === 0 ||
    href.length > MAX_PORTABLE_RICH_TEXT_URL_LENGTH ||
    /[\s\u0000-\u001f\u007f]/u.test(href)
  ) {
    errors.push(
      `${path}.attrs.href must be a bounded HTTP or HTTPS URL without whitespace`,
    );
    return false;
  }
  try {
    const parsed = new URL(href);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      errors.push(`${path}.attrs.href must be an HTTP or HTTPS URL without credentials`);
      return false;
    }
  } catch {
    errors.push(`${path}.attrs.href must be an absolute HTTP or HTTPS URL`);
    return false;
  }
  return valid;
}

function validatePortableRichTextMarks(
  value: unknown,
  path: string,
  errors: string[],
  state: PortableRichTextValidationState,
): value is PortableRichTextMark[] {
  if (!Array.isArray(value) || value.length > 5) {
    errors.push(`${path} must contain at most five supported marks`);
    return false;
  }

  let valid = true;
  const markTypes = new Set<string>();
  value.forEach((mark, index) => {
    if (!validatePortableRichTextMark(mark, `${path}[${index}]`, errors, state)) {
      valid = false;
    }
    if (isRecord(mark) && typeof mark.type === "string") {
      if (markTypes.has(mark.type)) {
        errors.push(`${path} cannot repeat the ${mark.type} mark`);
        valid = false;
      }
      markTypes.add(mark.type);
    }
  });
  return valid;
}

function validatePortableRichTextContent(
  value: unknown,
  path: string,
  errors: string[],
  state: PortableRichTextValidationState,
  parent: PortableRichTextParentType,
  depth: number,
  requireContent: boolean,
): value is PortableRichTextNode[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return false;
  }
  if (requireContent && value.length === 0) {
    errors.push(`${path} must contain at least one node`);
    return false;
  }
  if (value.length > MAX_PORTABLE_RICH_TEXT_NODES) {
    errors.push(`${path} exceeds the portable rich-text node limit`);
    return false;
  }

  let valid = true;
  value.forEach((child, index) => {
    if (
      !validatePortableRichTextNode(
        child,
        `${path}[${index}]`,
        errors,
        state,
        parent,
        depth,
      )
    ) {
      valid = false;
    }
  });
  return valid;
}

function validatePortableRichTextNode(
  value: unknown,
  path: string,
  errors: string[],
  state: PortableRichTextValidationState,
  parent: PortableRichTextParentType,
  depth: number,
): value is PortableRichTextNode {
  if (depth > MAX_PORTABLE_RICH_TEXT_DEPTH) {
    errors.push(`${path} exceeds the portable rich-text depth limit`);
    return false;
  }
  state.nodes += 1;
  if (state.nodes > MAX_PORTABLE_RICH_TEXT_NODES) {
    errors.push(`${path} exceeds the portable rich-text node limit`);
    return false;
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    errors.push(`${path} must be a supported rich-text node`);
    return false;
  }
  if (!portableNodeAllowedInParent(value.type, parent)) {
    errors.push(`${path}.type ${value.type} is not allowed inside ${parent}`);
    return false;
  }

  switch (value.type) {
    case "text": {
      let valid = validateExactObjectKeys(value, ["type", "text", "marks"], path, errors);
      if (typeof value.text !== "string" || value.text.length === 0) {
        errors.push(`${path}.text must be a non-empty string`);
        valid = false;
      } else {
        state.characters += value.text.length;
        if (state.characters > MAX_PORTABLE_RICH_TEXT_CHARACTERS) {
          errors.push(
            `${path} exceeds the ${MAX_PORTABLE_RICH_TEXT_CHARACTERS}-character document limit`,
          );
          valid = false;
        }
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.text)) {
          errors.push(`${path}.text contains unsupported control characters`);
          valid = false;
        }
      }
      if (
        value.marks !== undefined &&
        !validatePortableRichTextMarks(value.marks, `${path}.marks`, errors, state)
      ) {
        valid = false;
      }
      return valid;
    }
    case "hardBreak":
      state.characters += 1;
      if (state.characters > MAX_PORTABLE_RICH_TEXT_CHARACTERS) {
        errors.push(
          `${path} exceeds the ${MAX_PORTABLE_RICH_TEXT_CHARACTERS}-character document limit`,
        );
        return false;
      }
      return validateExactObjectKeys(value, ["type"], path, errors);
    case "paragraph": {
      let valid = validateExactObjectKeys(value, ["type", "content"], path, errors);
      if (
        value.content !== undefined &&
        !validatePortableRichTextContent(
          value.content,
          `${path}.content`,
          errors,
          state,
          "paragraph",
          depth + 1,
          false,
        )
      ) {
        valid = false;
      }
      return valid;
    }
    case "heading": {
      let valid = validateExactObjectKeys(value, ["type", "attrs", "content"], path, errors);
      if (!isRecord(value.attrs)) {
        errors.push(`${path}.attrs must contain a heading level`);
        valid = false;
      } else {
        if (!validateExactObjectKeys(value.attrs, ["level"], `${path}.attrs`, errors)) {
          valid = false;
        }
        if (value.attrs.level !== 2 && value.attrs.level !== 3) {
          errors.push(`${path}.attrs.level must be 2 or 3`);
          valid = false;
        }
      }
      if (
        value.content !== undefined &&
        !validatePortableRichTextContent(
          value.content,
          `${path}.content`,
          errors,
          state,
          "heading",
          depth + 1,
          false,
        )
      ) {
        valid = false;
      }
      return valid;
    }
    case "bulletList":
    case "orderedList": {
      let valid = validateExactObjectKeys(value, ["type", "content"], path, errors);
      if (
        !validatePortableRichTextContent(
          value.content,
          `${path}.content`,
          errors,
          state,
          value.type,
          depth + 1,
          true,
        )
      ) {
        valid = false;
      }
      return valid;
    }
    case "listItem": {
      let valid = validateExactObjectKeys(value, ["type", "content"], path, errors);
      if (
        Array.isArray(value.content) &&
        (value.content.length === 0 ||
          !isRecord(value.content[0]) ||
          value.content[0].type !== "paragraph")
      ) {
        errors.push(`${path}.content must begin with a paragraph`);
        valid = false;
      }
      if (
        !validatePortableRichTextContent(
          value.content,
          `${path}.content`,
          errors,
          state,
          "listItem",
          depth + 1,
          true,
        )
      ) {
        valid = false;
      }
      return valid;
    }
    case "blockquote": {
      let valid = validateExactObjectKeys(value, ["type", "content"], path, errors);
      if (
        !validatePortableRichTextContent(
          value.content,
          `${path}.content`,
          errors,
          state,
          "blockquote",
          depth + 1,
          true,
        )
      ) {
        valid = false;
      }
      return valid;
    }
    default:
      errors.push(`${path}.type is unsupported`);
      return false;
  }
}

function validatePortableRichTextDocumentAt(
  value: unknown,
  path: string,
  errors: string[],
): value is PortableRichTextDocument {
  const firstError = errors.length;
  if (!isRecord(value)) {
    errors.push(`${path} must be a portable rich-text document`);
    return false;
  }
  let valid = validateExactObjectKeys(value, ["type", "content"], path, errors);
  if (value.type !== "doc") {
    errors.push(`${path}.type must be doc`);
    valid = false;
  }

  const state: PortableRichTextValidationState = {
    nodes: 1,
    characters: 0,
    links: 0,
  };
  if (
    !validatePortableRichTextContent(
      value.content,
      `${path}.content`,
      errors,
      state,
      "doc",
      2,
      true,
    )
  ) {
    valid = false;
  }

  if (valid) {
    const flattened = flattenPortableRichText(value as PortableRichTextDocument);
    if (flattened.length > MAX_PORTABLE_RICH_TEXT_CHARACTERS) {
      errors.push(
        `${path} exceeds the ${MAX_PORTABLE_RICH_TEXT_CHARACTERS}-character document limit`,
      );
      valid = false;
    }
  }
  return valid && errors.length === firstError;
}

export function validatePortableRichTextDocument(
  value: unknown,
): PortableRichTextValidationResult {
  const errors: string[] = [];
  if (!validatePortableRichTextDocumentAt(value, "document", errors)) {
    return { success: false, errors };
  }
  return { success: true, data: value };
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
    value.metricId !== undefined &&
    value.metricId !== null &&
    (typeof value.metricId !== "string" ||
      !DECISION_REPORT_UUID_PATTERN.test(value.metricId))
  ) {
    errors.push(`${path}.metricId must be null, absent, or a UUID`);
  }

  if (
    value.monitoringExpectedDirection !== undefined &&
    value.monitoringExpectedDirection !== null &&
    !["INCREASE", "DECREASE"].includes(value.monitoringExpectedDirection as string)
  ) {
    errors.push(`${path}.monitoringExpectedDirection must be INCREASE, DECREASE, null, or absent`);
  }
  if (value.monitoringCheckDate !== undefined && value.monitoringCheckDate !== null) {
    const date = typeof value.monitoringCheckDate === "string"
      ? new Date(`${value.monitoringCheckDate}T00:00:00Z`)
      : null;
    if (
      typeof value.monitoringCheckDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.monitoringCheckDate) ||
      !date ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value.monitoringCheckDate
    ) {
      errors.push(`${path}.monitoringCheckDate must be a valid YYYY-MM-DD date, null, or absent`);
    }
  }

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
  actions: unknown[],
  errors: string[],
): value is DecisionReportActivationDraft {
  if (!isRecord(value)) {
    errors.push("activationDraft must be an object");
    return false;
  }

  if (
    value.confirmedMetricId !== null &&
    (typeof value.confirmedMetricId !== "string" ||
      !DECISION_REPORT_UUID_PATTERN.test(value.confirmedMetricId))
  ) {
    errors.push("activationDraft.confirmedMetricId must be null or a UUID");
  }

  const selectedMetrics = value.selectedMetricIds === undefined
    ? typeof value.confirmedMetricId === "string" &&
        DECISION_REPORT_UUID_PATTERN.test(value.confirmedMetricId)
      ? [value.confirmedMetricId]
      : []
    : value.selectedMetricIds;
  if (
    !Array.isArray(selectedMetrics) ||
    selectedMetrics.length > MAX_DECISION_REPORT_SELECTED_METRICS ||
    selectedMetrics.some(
      (metricId) =>
        typeof metricId !== "string" ||
        !DECISION_REPORT_UUID_PATTERN.test(metricId),
    ) ||
    new Set(selectedMetrics).size !== selectedMetrics.length
  ) {
    errors.push(
      `activationDraft.selectedMetricIds must contain up to ${MAX_DECISION_REPORT_SELECTED_METRICS} unique metric UUIDs`,
    );
  }
  if (
    typeof value.confirmedMetricId === "string" &&
    DECISION_REPORT_UUID_PATTERN.test(value.confirmedMetricId) &&
    Array.isArray(selectedMetrics) &&
    !selectedMetrics.includes(value.confirmedMetricId)
  ) {
    errors.push(
      "activationDraft.confirmedMetricId must be one of activationDraft.selectedMetricIds",
    );
  }

  if (Array.isArray(selectedMetrics)) {
    actions.forEach((action, index) => {
      if (
        isRecord(action) &&
        typeof action.metricId === "string" &&
        DECISION_REPORT_UUID_PATTERN.test(action.metricId) &&
        !selectedMetrics.includes(action.metricId)
      ) {
        errors.push(
          `implementation.actions[${index}].metricId must be one of activationDraft.selectedMetricIds`,
        );
      }
    });
  }

  const selected = value.selectedActionSourceItemIds;
  if (
    !Array.isArray(selected) ||
    selected.length > MAX_DECISION_REPORT_ACTIONS ||
    selected.some(
      (sourceItemId) =>
        typeof sourceItemId !== "string" ||
        sourceItemId.trim() === "" ||
        !actionSourceItemIds.has(sourceItemId),
    ) ||
    new Set(selected).size !== selected.length
  ) {
    errors.push(
      `activationDraft.selectedActionSourceItemIds must contain up to ${MAX_DECISION_REPORT_ACTIONS} unique report action IDs`,
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

function validateDecisionReportPresentation(
  value: unknown,
  claims: unknown[],
  errors: string[],
): value is DecisionReportPresentationV1 {
  if (!isRecord(value)) {
    errors.push("presentation must be a versioned rich-text presentation object");
    return false;
  }

  let valid = validateExactObjectKeys(
    value,
    ["version", "claimDocuments"],
    "presentation",
    errors,
  );
  if (value.version !== 1) {
    errors.push("presentation.version must be 1");
    valid = false;
  }
  if (!isRecord(value.claimDocuments)) {
    errors.push("presentation.claimDocuments must be a claim-keyed object");
    return false;
  }

  const entries = Object.entries(value.claimDocuments);
  if (entries.length > MAX_DECISION_REPORT_CLAIM_DOCUMENTS) {
    errors.push(
      `presentation.claimDocuments cannot exceed ${MAX_DECISION_REPORT_CLAIM_DOCUMENTS} documents`,
    );
    valid = false;
  }

  const claimTexts = new Map<string, string[]>();
  claims.forEach((claim) => {
    if (!isRecord(claim) || typeof claim.id !== "string" || typeof claim.text !== "string") {
      return;
    }
    const texts = claimTexts.get(claim.id) ?? [];
    texts.push(claim.text);
    claimTexts.set(claim.id, texts);
  });

  entries.forEach(([claimId, document]) => {
    const path = `presentation.claimDocuments[${JSON.stringify(claimId)}]`;
    const matchingTexts = claimTexts.get(claimId);
    if (!matchingTexts) {
      errors.push(`${path} must reference an existing claim ID`);
      valid = false;
    } else if (matchingTexts.length !== 1) {
      errors.push(`${path} cannot reference a duplicated claim ID`);
      valid = false;
    }

    if (!validatePortableRichTextDocumentAt(document, path, errors)) {
      valid = false;
      return;
    }
    if (
      matchingTexts?.length === 1 &&
      flattenPortableRichText(document) !== matchingTexts[0]
    ) {
      errors.push(`${path} flattened content must equal Claim.text`);
      valid = false;
    }
  });

  try {
    const serializedBytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (serializedBytes > MAX_DECISION_REPORT_PRESENTATION_BYTES) {
      errors.push(
        `presentation cannot exceed ${MAX_DECISION_REPORT_PRESENTATION_BYTES} serialized bytes`,
      );
      valid = false;
    }
  } catch {
    errors.push("presentation must be serializable JSON");
    valid = false;
  }

  return valid;
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
  let reportActions: unknown[] = [];
  if (!isRecord(implementation)) {
    errors.push("implementation must be an object");
  } else {
    validateClaimArray(implementation.actionPlanSummary, "implementation.actionPlanSummary", errors);
    validateClaimArray(implementation.customers, "implementation.customers", errors);
    validateClaimArray(implementation.stakeholders, "implementation.stakeholders", errors);

    if (!Array.isArray(implementation.actions)) {
      errors.push("implementation.actions must be an array");
    } else {
      reportActions = implementation.actions;
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
    validateActivationDraft(
      value.activationDraft,
      actionSourceItemIds,
      reportActions,
      errors,
    );
  } else {
    reportActions.forEach((action, index) => {
      if (
        isRecord(action) &&
        typeof action.metricId === "string" &&
        DECISION_REPORT_UUID_PATTERN.test(action.metricId)
      ) {
        errors.push(
          `implementation.actions[${index}].metricId requires activationDraft.selectedMetricIds`,
        );
      }
    });
  }

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

  if (value.presentation !== undefined) {
    validateDecisionReportPresentation(value.presentation, claims, errors);
  }

  if (value.schemaVersion === 2 && persistedChunkIds) {
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
