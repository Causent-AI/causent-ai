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
  primaryLeverActionSourceItemId: string;
};

export type ReportActivationActionMetricAssignment = {
  actionSourceItemId: string;
  metricId: string;
};

export type ReportActivationInputV2 = {
  schemaVersion: 2;
  reportId: string;
  revisionId: string;
  confirmedMetricId: string;
  selectedMetricIds: string[];
  prediction: {
    direction: "POSITIVE" | "NEGATIVE";
    magnitudePctMean: number;
    resolutionDate: string;
  };
  selectedActionSourceItemIds: string[];
  actionMetricAssignments: ReportActivationActionMetricAssignment[];
  primaryLeverActionSourceItemId: string;
};

export type ReportActivationInput = ReportActivationInputV1 | ReportActivationInputV2;

export type ReportActivationInputValidation<T extends ReportActivationInput = ReportActivationInput> =
  | { success: true; data: T }
  | { success: false; errors: string[] };

export type ReportActivationValidationOptions = {
  today?: string;
  /**
   * Checked materialization defers this one mutable rule to the database so an
   * exact v2 retry can still recover its immutable receipt after the due date.
   */
  allowExpiredResolutionDate?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateReportActivationInputV1(
  value: unknown,
  options: ReportActivationValidationOptions = {},
): ReportActivationInputValidation<ReportActivationInputV1> {
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
    const invalidResolutionDate =
      typeof resolutionDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(resolutionDate) ||
      !parsedResolutionDate ||
      Number.isNaN(parsedResolutionDate.getTime()) ||
      parsedResolutionDate.toISOString().slice(0, 10) !== resolutionDate;
    if (invalidResolutionDate) {
      errors.push("prediction.resolutionDate must be a valid YYYY-MM-DD date");
    } else {
      const today = options.today ?? new Date().toISOString().slice(0, 10);
      if (resolutionDate <= today) {
        errors.push("prediction.resolutionDate must be in the future");
      }
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
  if (
    typeof value.primaryLeverActionSourceItemId !== "string" ||
    value.primaryLeverActionSourceItemId.trim() === ""
  ) {
    errors.push("primaryLeverActionSourceItemId must identify one selected action");
  } else if (
    Array.isArray(value.selectedActionSourceItemIds) &&
    !value.selectedActionSourceItemIds.includes(value.primaryLeverActionSourceItemId)
  ) {
    errors.push("primaryLeverActionSourceItemId must be one of the selected actions");
  }

  return errors.length === 0
    ? { success: true, data: value as ReportActivationInputV1 }
    : { success: false, errors };
}

export function validateReportActivationInputV2(
  value: unknown,
  options: ReportActivationValidationOptions = {},
): ReportActivationInputValidation<ReportActivationInputV2> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { success: false, errors: ["activation input must be an object"] };
  }

  if (value.schemaVersion !== 2) errors.push("schemaVersion must be 2");
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
    const invalidResolutionDate =
      typeof resolutionDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(resolutionDate) ||
      !parsedResolutionDate ||
      Number.isNaN(parsedResolutionDate.getTime()) ||
      parsedResolutionDate.toISOString().slice(0, 10) !== resolutionDate;
    if (invalidResolutionDate) {
      errors.push("prediction.resolutionDate must be a valid YYYY-MM-DD date");
    } else {
      const today = options.today ?? new Date().toISOString().slice(0, 10);
      if (!options.allowExpiredResolutionDate && resolutionDate <= today) {
        errors.push("prediction.resolutionDate must be in the future");
      }
    }
  }

  const selectedMetricIds = Array.isArray(value.selectedMetricIds)
    ? value.selectedMetricIds
    : null;
  if (!selectedMetricIds) {
    errors.push("selectedMetricIds must be an array");
  } else {
    if (selectedMetricIds.length < 1 || selectedMetricIds.length > 5) {
      errors.push("selectedMetricIds must contain one to five metrics");
    }
    if (selectedMetricIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))) {
      errors.push("selectedMetricIds must contain UUIDs");
    }
    if (new Set(selectedMetricIds).size !== selectedMetricIds.length) {
      errors.push("selectedMetricIds cannot contain duplicates");
    }
    if (
      typeof value.confirmedMetricId === "string" &&
      !selectedMetricIds.includes(value.confirmedMetricId)
    ) {
      errors.push("selectedMetricIds must include confirmedMetricId");
    }
  }

  const selectedActionIds = Array.isArray(value.selectedActionSourceItemIds)
    ? value.selectedActionSourceItemIds
    : null;
  if (!selectedActionIds) {
    errors.push("selectedActionSourceItemIds must be an array");
  } else {
    if (selectedActionIds.length < 1 || selectedActionIds.length > 25) {
      errors.push("selectedActionSourceItemIds must contain one to twenty-five actions");
    }
    if (selectedActionIds.some((id) => typeof id !== "string" || id.trim() === "")) {
      errors.push("selectedActionSourceItemIds must contain non-empty strings");
    }
    if (new Set(selectedActionIds).size !== selectedActionIds.length) {
      errors.push("selectedActionSourceItemIds cannot contain duplicates");
    }
  }

  if (
    typeof value.primaryLeverActionSourceItemId !== "string" ||
    value.primaryLeverActionSourceItemId.trim() === ""
  ) {
    errors.push("primaryLeverActionSourceItemId must identify one selected action");
  } else if (
    selectedActionIds &&
    !selectedActionIds.includes(value.primaryLeverActionSourceItemId)
  ) {
    errors.push("primaryLeverActionSourceItemId must be one of the selected actions");
  }

  const assignments = Array.isArray(value.actionMetricAssignments)
    ? value.actionMetricAssignments
    : null;
  if (!assignments) {
    errors.push("actionMetricAssignments must be an array");
  } else {
    const validAssignments = assignments.filter((assignment): assignment is Record<string, unknown> =>
      isRecord(assignment)
    );
    if (validAssignments.length !== assignments.length) {
      errors.push("actionMetricAssignments must contain assignment objects");
    }
    if (selectedActionIds && assignments.length !== selectedActionIds.length) {
      errors.push("actionMetricAssignments must contain exactly one assignment per selected action");
    }

    const assignmentActionIds = validAssignments.map((assignment) =>
      assignment.actionSourceItemId
    );
    if (
      assignmentActionIds.some((id) => typeof id !== "string" || id.trim() === "")
    ) {
      errors.push("every action metric assignment must identify an action");
    }
    if (new Set(assignmentActionIds).size !== assignmentActionIds.length) {
      errors.push("actionMetricAssignments cannot assign an action more than once");
    }
    if (
      selectedActionIds &&
      (assignmentActionIds.some((id) => !selectedActionIds.includes(id as string)) ||
        selectedActionIds.some((id) => !assignmentActionIds.includes(id)))
    ) {
      errors.push("actionMetricAssignments must match the selected actions");
    }

    const assignmentMetricIds = validAssignments.map((assignment) => assignment.metricId);
    if (assignmentMetricIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))) {
      errors.push("every action metric assignment must identify a metric UUID");
    }
    if (
      selectedMetricIds &&
      assignmentMetricIds.some((id) => !selectedMetricIds.includes(id as string))
    ) {
      errors.push("every action metric assignment must use a selected metric");
    }

    if (
      typeof value.primaryLeverActionSourceItemId === "string" &&
      typeof value.confirmedMetricId === "string"
    ) {
      const primaryAssignment = validAssignments.find(
        (assignment) =>
          assignment.actionSourceItemId === value.primaryLeverActionSourceItemId,
      );
      if (primaryAssignment?.metricId !== value.confirmedMetricId) {
        errors.push("the primary lever action must use confirmedMetricId");
      }
    }
  }

  return errors.length === 0
    ? { success: true, data: value as ReportActivationInputV2 }
    : { success: false, errors };
}

export function validateReportActivationInput(
  value: unknown,
  options: ReportActivationValidationOptions = {},
): ReportActivationInputValidation {
  if (!isRecord(value)) {
    return { success: false, errors: ["activation input must be an object"] };
  }
  if (value.schemaVersion === 1) return validateReportActivationInputV1(value, options);
  if (value.schemaVersion === 2) return validateReportActivationInputV2(value, options);
  return { success: false, errors: ["schemaVersion must be 1 or 2"] };
}
