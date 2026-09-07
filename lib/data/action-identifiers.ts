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
 * Preserve historical demo `PR #N` deep links. Provider ingests use the action
 * UUID so the same PR number in two repositories cannot collide in the UI.
 */
export function toActionIdentity(row: ActionIdentityInput): ActionIdentity {
  const prMatch = row.source === "github_pr"
    ? row.external_ref?.match(GITHUB_PR_PATTERN)
    : null;
  if (prMatch) {
    const pr = Number(prMatch[1]);
    return { uiId: `a-${pr}`, pr, source: "github", referenceLabel: `#${pr}` };
  }

  const github = row.external_ref?.match(/^github:(?:repo:id:[1-9][0-9]*:)?(pr|issue):([1-9][0-9]*)$/);
  if (github && row.source === (github[1] === "pr" ? "github_pr" : "github_issue")) {
    return { uiId: row.action_id, pr: github[1] === "pr" ? Number(github[2]) : 0,
      source: "github", referenceLabel: `${github[1] === "pr" ? "PR" : "Issue"} #${github[2]}` };
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
