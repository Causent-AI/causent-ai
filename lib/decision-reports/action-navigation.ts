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
