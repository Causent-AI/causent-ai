export type ReportLifecycleStage =
  | "finish_report"
  | "set_commitment"
  | "start_action"
  | "active";

export function inferMetricPercentScale(
  format: "currency" | "percent" | "count",
  series: ReadonlyArray<{ value: number }>,
): "ratio" | "points" {
  if (format !== "percent" || series.length === 0) return "points";
  return series.every(
    (observation) =>
      Number.isFinite(observation.value) && Math.abs(observation.value) <= 1,
  )
    ? "ratio"
    : "points";
}

export type ReportLifecyclePresentation = {
  stage: ReportLifecycleStage;
  label: string;
  title: string;
  detail: string;
  actionLabel: string | null;
};

export function reportLifecyclePresentation(input: {
  active: boolean;
  requiredFieldCount: number;
  commitmentReady: boolean;
  actionCount: number;
}): ReportLifecyclePresentation {
  const actionNoun = input.actionCount === 1 ? "action" : "actions";

  if (input.active) {
    return {
      stage: "active",
      label: "Plan active",
      title: `${input.actionCount} ${actionNoun} activated`,
      detail: "Execution and measurement are underway.",
      actionLabel: null,
    };
  }

  if (input.requiredFieldCount > 0) {
    const fieldNoun = input.requiredFieldCount === 1 ? "field" : "fields";
    return {
      stage: "finish_report",
      label: "Finish report",
      title: `${input.requiredFieldCount} required ${fieldNoun} remaining`,
      detail: "",
      actionLabel: "Next field",
    };
  }

  if (!input.commitmentReady) {
    return {
      stage: "set_commitment",
      label: "Set commitment",
      title: "Complete the outcome commitment",
      detail: `${input.actionCount} ${actionNoun} included`,
      actionLabel: "Next commitment",
    };
  }

  return {
    stage: "start_action",
    label: "Start an action",
    title: `${input.actionCount} ${actionNoun} ready`,
    detail: `Starting one activates all ${input.actionCount}.`,
    actionLabel: "Go to Start",
  };
}

export function signedCommitmentLabel(
  direction: "POSITIVE" | "NEGATIVE",
  magnitudePctMean: number,
): string {
  const sign = direction === "POSITIVE" ? "+" : "−";
  const magnitude = Number.isInteger(magnitudePctMean)
    ? magnitudePctMean.toFixed(0)
    : magnitudePctMean.toFixed(1);
  return `${sign}${magnitude}% of mean`;
}

export function reportExecutionState(input: {
  actionCount: number;
  completedActionCount: number;
  verdictLabel: string | null;
}): string {
  if (input.verdictLabel) return input.verdictLabel;
  if (input.actionCount > 0 && input.completedActionCount === input.actionCount) {
    return "Measuring";
  }
  if (input.completedActionCount > 0) return "In progress";
  return "Active";
}

export function latestMetricObservationAt(
  series: ReadonlyArray<{ date: string; value: number }>,
  date: string,
): { date: string; value: number } | null {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const observation = series[index];
    if (observation.date <= date && Number.isFinite(observation.value)) {
      return observation;
    }
  }
  return null;
}

export function latestMetricValueAt(
  series: ReadonlyArray<{ date: string; value: number }>,
  date: string,
): number | null {
  return latestMetricObservationAt(series, date)?.value ?? null;
}
