export type ActionIdentityInput = {
  action_id: string;
  source: string | null;
  external_ref: string | null;
};

export type ActionIdentity = {
  uiId: string;
  pr: number;
  source: "github" | "jira" | "manual";
  referenceLabel: string;
};

const GITHUB_PR_PATTERN = /^PR\s*#(\d+)$/i;

/**
 * Preserve the historical `a-<pr>` UI identity for ingested pull requests,
 * while keeping Jira and report-created manual actions keyed by UUID. Parsing
 * arbitrary digits made unrelated actions collide as `a-0` or `a-12`.
 */
export function toActionIdentity(row: ActionIdentityInput): ActionIdentity {
  const prMatch = row.source === "github_pr"
    ? row.external_ref?.match(GITHUB_PR_PATTERN)
    : null;
  if (prMatch) {
    const pr = Number(prMatch[1]);
    return { uiId: `a-${pr}`, pr, source: "github", referenceLabel: `#${pr}` };
  }

  if (row.source === "jira") {
    return {
      uiId: row.action_id,
      pr: 0,
      source: "jira",
      referenceLabel: row.external_ref?.trim() || "Jira draft",
    };
  }

  if (row.source === "github_issue") {
    return {
      uiId: row.action_id,
      pr: 0,
      source: "github",
      referenceLabel: row.external_ref?.trim() || "GitHub draft",
    };
  }

  return {
    uiId: row.action_id,
    pr: 0,
    source: "manual",
    referenceLabel: "Planned",
  };
}
