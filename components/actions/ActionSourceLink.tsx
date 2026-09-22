import type { Action } from "@/lib/types";
export function ActionSourceLink({ action }: { action: Action }) {
  return action.sourceUrl ? (
    <a
      className="ml-2 text-[var(--brand-blue)] underline underline-offset-2"
      href={action.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
    >
      {action.sourceUrl.includes("/pull/") ? "Open PR ↗" : "Open issue ↗"}
    </a>
  ) : null;
}
