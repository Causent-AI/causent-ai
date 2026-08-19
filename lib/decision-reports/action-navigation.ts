export function decisionReportActionDestination({
  actionId,
  decisionId,
}: {
  actionId: string | null;
  decisionId: string;
}): string {
  if (actionId) {
    const encodedActionId = encodeURIComponent(actionId);
    return `/actions?selected=${encodedActionId}#${encodedActionId}`;
  }

  return `/actions?selected=${encodeURIComponent(decisionId)}`;
}

export function activeDecisionReportActionDestination({
  actionSourceItemId,
  actionBindings,
  decisionId,
}: {
  actionSourceItemId: string;
  actionBindings: Array<{ actionId: string; actionSourceItemId: string }>;
  decisionId: string;
}): string | null {
  const binding = actionBindings.find(
    (candidate) => candidate.actionSourceItemId === actionSourceItemId,
  );
  return binding
    ? decisionReportActionDestination({
        actionId: binding.actionId,
        decisionId,
      })
    : null;
}
