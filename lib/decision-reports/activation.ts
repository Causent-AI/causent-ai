import { UUID_PATTERN } from "./persistence.ts";

export type ReportActivationInputV1 = {
  schemaVersion: 1;
  reportId: string;
  revisionId: string;
  confirmedMetricId: string;
  prediction: {
    direction: "POSITIVE" | "NEGATIVE";
    magnitudePctMean: number;
    resolutionDate: string;
  };
  selectedActionSourceItemIds: string[];
};

export type ReportActivationInputValidation =
  | { success: true; data: ReportActivationInputV1 }
  | { success: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateReportActivationInputV1(
  value: unknown,
): ReportActivationInputValidation {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { success: false, errors: ["activation input must be an object"] };
  }

  if (value.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  for (const field of ["reportId", "revisionId", "confirmedMetricId"] as const) {
    if (typeof value[field] !== "string" || !UUID_PATTERN.test(value[field])) {
      errors.push(`${field} must be a UUID`);
    }
  }

  if (!isRecord(value.prediction)) {
    errors.push("prediction must be an object");
  } else {
    if (!["POSITIVE", "NEGATIVE"].includes(value.prediction.direction as string)) {
      errors.push("prediction.direction is invalid");
    }
    if (
      typeof value.prediction.magnitudePctMean !== "number" ||
      !Number.isFinite(value.prediction.magnitudePctMean) ||
      value.prediction.magnitudePctMean <= 0
    ) {
      errors.push("prediction.magnitudePctMean must be a positive finite number");
    }
    const resolutionDate = value.prediction.resolutionDate;
    const parsedResolutionDate = typeof resolutionDate === "string"
      ? new Date(`${resolutionDate}T00:00:00Z`)
      : null;
    if (
      typeof resolutionDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(resolutionDate) ||
      !parsedResolutionDate ||
      Number.isNaN(parsedResolutionDate.getTime()) ||
      parsedResolutionDate.toISOString().slice(0, 10) !== resolutionDate
    ) {
      errors.push("prediction.resolutionDate must be a valid YYYY-MM-DD date");
    }
  }

  if (!Array.isArray(value.selectedActionSourceItemIds)) {
    errors.push("selectedActionSourceItemIds must be an array");
  } else {
    const actionIds = value.selectedActionSourceItemIds;
    if (actionIds.length < 1 || actionIds.length > 3) {
      errors.push("selectedActionSourceItemIds must contain one to three actions");
    }
    if (actionIds.some((id) => typeof id !== "string" || id.trim() === "")) {
      errors.push("selectedActionSourceItemIds must contain non-empty strings");
    }
    if (new Set(actionIds).size !== actionIds.length) {
      errors.push("selectedActionSourceItemIds cannot contain duplicates");
    }
  }

  return errors.length === 0
    ? { success: true, data: value as ReportActivationInputV1 }
    : { success: false, errors };
}
