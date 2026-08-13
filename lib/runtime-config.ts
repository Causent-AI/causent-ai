export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export type RuntimeConfigIssue = {
  code: "missing_required" | "forbidden_production_flag" | "invalid_url";
  variable: string;
};

export type RuntimeConfigValidation = {
  ok: boolean;
  production: boolean;
  issues: RuntimeConfigIssue[];
};

export type ReleaseConfigTarget = "app" | "worker" | "resolver";

export const PRODUCTION_APP_REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  // Report generation mints a server-only, single-use provenance receipt before
  // the authenticated first save. The mint RPC is intentionally service-role-only.
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export const PRODUCTION_FORBIDDEN_LOCAL_FLAGS = [
  "CAUSENT_LOCAL_DEMO",
  "CAUSENT_USE_SEED",
  "CAUSENT_DECISION_REPORT_FIXTURE",
  "CAUSENT_DECISION_REPORT_LOCAL_ROLLOUT",
  // A historical demo clock would keep new real-world predictions from ever
  // becoming due in the production resolution sweep.
  "CAUSENT_DEMO_TODAY",
] as const;

const APP_RELEASE_REQUIRED_ENV = [
  "CAUSENT_RECOMPUTE_URL",
  "CAUSENT_RECOMPUTE_SECRET",
  "CAUSENT_RESOLVE_URL",
  "CAUSENT_RESOLVE_SECRET",
  "CRON_SECRET",
] as const;

const WORKER_RELEASE_REQUIRED_ENV = [
  "DATABASE_URL",
  "CAUSENT_RECOMPUTE_SECRET",
] as const;

const RESOLVER_RELEASE_REQUIRED_ENV = [
  "DATABASE_URL",
  "CAUSENT_RESOLVE_SECRET",
] as const;

function value(env: RuntimeEnvironment, variable: string): string {
  return env[variable]?.trim() ?? "";
}

function pushMissing(
  issues: RuntimeConfigIssue[],
  env: RuntimeEnvironment,
  variables: readonly string[],
): void {
  for (const variable of variables) {
    if (!value(env, variable)) issues.push({ code: "missing_required", variable });
  }
}

function pushInvalidHttpsUrl(
  issues: RuntimeConfigIssue[],
  env: RuntimeEnvironment,
  variable: string,
): void {
  const candidate = value(env, variable);
  if (!candidate) return;
  try {
    if (new URL(candidate).protocol !== "https:") {
      issues.push({ code: "invalid_url", variable });
    }
  } catch {
    issues.push({ code: "invalid_url", variable });
  }
}

function pushInvalidPostgresUrl(
  issues: RuntimeConfigIssue[],
  env: RuntimeEnvironment,
  variable: string,
): void {
  const candidate = value(env, variable);
  if (!candidate) return;
  try {
    const protocol = new URL(candidate).protocol;
    if (protocol !== "postgres:" && protocol !== "postgresql:") {
      issues.push({ code: "invalid_url", variable });
    }
  } catch {
    issues.push({ code: "invalid_url", variable });
  }
}

/**
 * Vercel previews use NODE_ENV=production too, so VERCEL_ENV wins when present.
 * Outside Vercel, `next start` remains a production runtime and is validated.
 */
export function isProductionDeployment(env: RuntimeEnvironment): boolean {
  const vercelEnvironment = value(env, "VERCEL_ENV");
  if (vercelEnvironment) return vercelEnvironment === "production";
  return value(env, "NODE_ENV") === "production";
}

/**
 * Validate only the configuration required to serve the production Next app.
 * Development and Vercel preview behavior remains unchanged.
 */
export function validateProductionAppRuntime(
  env: RuntimeEnvironment,
): RuntimeConfigValidation {
  const production = isProductionDeployment(env);
  if (!production) return { ok: true, production: false, issues: [] };

  const issues: RuntimeConfigIssue[] = [];
  pushMissing(issues, env, PRODUCTION_APP_REQUIRED_ENV);
  pushInvalidHttpsUrl(issues, env, "NEXT_PUBLIC_SUPABASE_URL");

  for (const variable of PRODUCTION_FORBIDDEN_LOCAL_FLAGS) {
    // Production flags are required to be absent, not merely set to "0", so a
    // stale Vercel value cannot be mistaken for an intentionally safe default.
    if (value(env, variable)) {
      issues.push({ code: "forbidden_production_flag", variable });
    }
  }

  return { ok: issues.length === 0, production, issues };
}

/** Network-free validation for the separately deployed production targets. */
export function validateReleaseConfig(
  target: ReleaseConfigTarget,
  env: RuntimeEnvironment,
): RuntimeConfigValidation {
  if (target === "worker") {
    const issues: RuntimeConfigIssue[] = [];
    pushMissing(issues, env, WORKER_RELEASE_REQUIRED_ENV);
    pushInvalidPostgresUrl(issues, env, "DATABASE_URL");
    return { ok: issues.length === 0, production: true, issues };
  }
  if (target === "resolver") {
    const issues: RuntimeConfigIssue[] = [];
    pushMissing(issues, env, RESOLVER_RELEASE_REQUIRED_ENV);
    pushInvalidPostgresUrl(issues, env, "DATABASE_URL");
    return { ok: issues.length === 0, production: true, issues };
  }

  const runtime = validateProductionAppRuntime({
    ...env,
    VERCEL_ENV: "production",
  });
  const issues = [...runtime.issues];
  pushMissing(issues, env, APP_RELEASE_REQUIRED_ENV);
  pushInvalidHttpsUrl(issues, env, "CAUSENT_RECOMPUTE_URL");
  pushInvalidHttpsUrl(issues, env, "CAUSENT_RESOLVE_URL");
  return { ok: issues.length === 0, production: true, issues };
}
