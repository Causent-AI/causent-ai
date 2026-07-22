import type { Action } from "@/lib/types";
import { GitHubIcon, PlusIcon } from "@/components/ui/icons";

export function actionReferenceLabel(action: Action): string {
  return action.referenceLabel ?? (action.pr > 0 ? `#${action.pr}` : "Planned");
}

export function ActionSourceIcon({
  action,
  size = 18,
  className = "",
}: {
  action: Action;
  size?: number;
  className?: string;
}) {
  if (action.source === "manual") {
    return <PlusIcon size={size} className={className} />;
  }
  if (action.source === "jira") {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded bg-blue-50 font-bold text-blue-700 ${className}`}
        style={{ width: size, height: size, fontSize: Math.max(9, size * 0.55) }}
        aria-hidden="true"
      >
        J
      </span>
    );
  }
  return <GitHubIcon size={size} className={className} />;
}
