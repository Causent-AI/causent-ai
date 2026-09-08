export const measurementReasons: Record<string, string> = {
  METRIC_DEFINITION_REQUIRED: "Confirm the metric definition before measurement.",
  MEASUREMENT_PLAN_REQUIRED: "Register a measurement plan before exposure. Retrospective attribution is unavailable.",
  METRIC_DEFINITION_MISMATCH: "The metric definition differs from the registered plan.",
  UNSUPPORTED_DESIGN: "This measurement design is not supported.",
  STAGED_EXPOSURE_UNSUPPORTED: "Staged exposure cannot be represented by one breakpoint.",
  CONCURRENT_CHANGES_NOT_ISOLATED: "Concurrent changes prevent attribution.",
  WAITING_FOR_FIXED_HORIZON: "Waiting for the registered review horizon. No repeated significance checks are shown.",
  EXPOSURE_NOT_DOCUMENTED: "Record actual exposure for every included action.",
  EXPOSURE_DIFFERS_FROM_PLAN: "Actual exposure differs from the registered plan; attribution is unavailable.",
  REGISTERED_PRIMARY_REQUIRED: "A registered primary outcome is required.",
  PACKAGE_INCOMPLETE: "The included action package is incomplete.",
  FIXED_WINDOW_INCOMPLETE: "The registered daily window has missing or invalid observations.",
};
export function measurementReason(reason: string | null | undefined): string {
  return reason ? measurementReasons[reason] ?? "The measurement contract could not be evaluated." : "No registered measurement is available.";
}
