import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A cron invocation deliberately handles only a bounded number of workspaces.
 * A later invocation advances naturally because terminal predictions disappear
 * from the due-workspace query.
 */
export const MAX_RESOLUTION_WORKSPACES = 20;
export const RESOLUTION_WORKER_CONCURRENCY = 4;
export const RESOLUTION_CUTOFF_HOUR_UTC = 15;

const MAX_ACTOR_CANDIDATES_PER_WORKSPACE = 32;
// PostgreSQL's uuid input accepts the canonical 8-4-4-4-12 hex shape without
// requiring an RFC version/variant nibble. Causent's stable seed identifiers
// intentionally use zeroes in those positions, so validate the database type's
// lexical contract here (still strict enough to make the PostgREST filter safe).
const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const WRITER_ROLES = new Set(["member", "admin", "owner"]);

type ProjectRelation = { org_id: unknown } | Array<{ org_id: unknown }> | null;

type DueWorkspaceRow = {
  workspace_id: unknown;
  project_id: unknown;
  projects: ProjectRelation;
};

type MembershipRow = {
  user_id: unknown;
  org_id: unknown;
  project_id: unknown;
  workspace_id: unknown;
  role: unknown;
  created_at?: unknown;
};

type ScopeCoordinates = {
  workspaceId: string;
  projectId: string;
  orgId: string;
};

export type ResolutionTarget = {
  scopeId: string;
  userId: string;
};

export type ResolutionTargetBatch = {
  targets: ResolutionTarget[];
  truncated: boolean;
};

/**
 * Keep the original 15:00 UTC business-day cutoff while allowing the cron to
 * run frequently enough to drain a bounded workspace backlog. Before 15:00,
 * only predictions due through the previous UTC date are eligible.
 */
export function resolutionDayForCron(now: Date): string {
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError("now must be a valid date");
  }
  const day = new Date(now);
  if (day.getUTCHours() < RESOLUTION_CUTOFF_HOUR_UTC) {
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return day.toISOString().slice(0, 10);
}

export function resolutionWorkerPayload(
  scopeId: string,
  userId: string | undefined,
  today: string | undefined,
): { scope_id: string; user_id?: string; today?: string } {
  return {
    scope_id: scopeId,
    ...(userId ? { user_id: userId } : {}),
    ...(today ? { today } : {}),
  };
}

export class ResolutionScopeDiscoveryError extends Error {
  readonly code:
    | "due_workspace_query_failed"
    | "invalid_scope_row"
    | "actor_query_failed"
    | "no_eligible_actor";

  constructor(code: ResolutionScopeDiscoveryError["code"]) {
    super("Resolution scope discovery failed.");
    this.name = "ResolutionScopeDiscoveryError";
    this.code = code;
  }
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

function relatedOrgId(projects: ProjectRelation): string | null {
  const project = Array.isArray(projects) ? projects[0] : projects;
  return uuid(project?.org_id);
}

function scopeCoordinates(row: DueWorkspaceRow): ScopeCoordinates | null {
  const workspaceId = uuid(row.workspace_id);
  const projectId = uuid(row.project_id);
  const orgId = relatedOrgId(row.projects);
  return workspaceId && projectId && orgId ? { workspaceId, projectId, orgId } : null;
}

function membershipCoversScope(
  membership: MembershipRow,
  scope: ScopeCoordinates,
): membership is MembershipRow & { user_id: string; role: "member" | "admin" | "owner" } {
  const userId = uuid(membership.user_id);
  if (!userId || !WRITER_ROLES.has(String(membership.role))) return false;
  if (uuid(membership.org_id) !== scope.orgId) return false;

  const projectId = membership.project_id === null ? null : uuid(membership.project_id);
  const workspaceId = membership.workspace_id === null ? null : uuid(membership.workspace_id);
  if (membership.project_id !== null && !projectId) return false;
  if (membership.workspace_id !== null && !workspaceId) return false;

  return (projectId === null || projectId === scope.projectId)
    && (workspaceId === null || workspaceId === scope.workspaceId);
}

function actorOrder(membership: MembershipRow): string {
  // Prefer the least-privileged role that can perform the resolver's writes.
  const rank = membership.role === "member" ? "0" : membership.role === "admin" ? "1" : "2";
  return `${rank}:${String(membership.created_at ?? "")}:${String(membership.user_id)}`;
}

async function eligibleActor(
  client: SupabaseClient,
  scope: ScopeCoordinates,
): Promise<string> {
  // This mirrors has_scope_grant(): org must match; project/workspace grants
  // inherit when NULL, otherwise they must match the target coordinates.
  const coverage = [
    "and(project_id.is.null,workspace_id.is.null)",
    `and(project_id.is.null,workspace_id.eq.${scope.workspaceId})`,
    `and(project_id.eq.${scope.projectId},workspace_id.is.null)`,
    `and(project_id.eq.${scope.projectId},workspace_id.eq.${scope.workspaceId})`,
  ].join(",");

  const response = await client
    .from("memberships")
    .select("user_id, org_id, project_id, workspace_id, role, created_at")
    .eq("org_id", scope.orgId)
    .in("role", ["member", "admin", "owner"])
    .or(coverage)
    .order("created_at", { ascending: true })
    .order("user_id", { ascending: true })
    .limit(MAX_ACTOR_CANDIDATES_PER_WORKSPACE);

  if (response.error) {
    throw new ResolutionScopeDiscoveryError("actor_query_failed");
  }

  const candidates = ((response.data ?? []) as unknown as MembershipRow[])
    .filter((membership) => membershipCoversScope(membership, scope))
    .sort((left, right) => actorOrder(left).localeCompare(actorOrder(right)));
  const actor = candidates[0];
  const userId = uuid(actor?.user_id);
  if (!userId) {
    throw new ResolutionScopeDiscoveryError("no_eligible_actor");
  }
  return userId;
}

/**
 * Discover due production work without accepting a caller-supplied scope or
 * actor. The service-role client identifies due workspaces; each selected actor
 * is then rechecked against the same inherited membership rules enforced by
 * RLS. Viewer-only and malformed rows fail closed.
 */
export async function listProductionResolutionTargets(
  client: SupabaseClient,
  today: string,
): Promise<ResolutionTargetBatch> {
  const response = await client
    .from("workspaces")
    .select(
      "workspace_id, project_id, projects!inner(org_id), predictions!inner(prediction_id)",
    )
    .is("predictions.resolved_at", null)
    .lte("predictions.resolution_date", today)
    .order("workspace_id", { ascending: true })
    .limit(MAX_RESOLUTION_WORKSPACES + 1)
    .limit(1, { referencedTable: "predictions" });

  if (response.error) {
    throw new ResolutionScopeDiscoveryError("due_workspace_query_failed");
  }

  const dueRows = (response.data ?? []) as unknown as DueWorkspaceRow[];
  const selectedRows = dueRows.slice(0, MAX_RESOLUTION_WORKSPACES);
  const scopes = selectedRows.map(scopeCoordinates);
  if (scopes.some((scope) => scope === null)) {
    throw new ResolutionScopeDiscoveryError("invalid_scope_row");
  }

  const targets = await mapWithConcurrency(
    scopes as ScopeCoordinates[],
    RESOLUTION_WORKER_CONCURRENCY,
    async (scope) => ({
      scopeId: scope.workspaceId,
      userId: await eligibleActor(client, scope),
    }),
  );

  return {
    targets,
    truncated: dueRows.length > MAX_RESOLUTION_WORKSPACES,
  };
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  work: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive integer");
  }
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await work(values[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}
