export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export type RuntimeConfigIssue = {
  code:
    | "missing_required"
    | "forbidden_production_flag"
    | "invalid_url"
    | "weak_secret";
  variable: string;
};

export type RuntimeConfigValidation = {
  ok: boolean;
  production: boolean;
  issues: RuntimeConfigIssue[];
};

export type ReleaseConfigTarget = "app" | "worker" | "resolver" | "drift";

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
  "CAUSENT_DRIFT_URL",
  "CAUSENT_DRIFT_SECRET",
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

const DRIFT_RELEASE_REQUIRED_ENV = [
  "DATABASE_URL",
  "CAUSENT_DRIFT_SECRET",
] as const;

const APP_RELEASE_SECRET_ENV = [
  "CAUSENT_DRIFT_SECRET",
  "CAUSENT_RECOMPUTE_SECRET",
  "CAUSENT_RESOLVE_SECRET",
  "CRON_SECRET",
] as const;

const PLACEHOLDER_SECRET_MARKERS = [
  "changeme",
  "replaceme",
  "placeholder",
  "notsecure",
  "insecure",
  "password",
  "letmein",
  "dummy",
  "example",
  "sample",
  "testonly",
  "testsecret",
  "yoursecret",
  "secretvalue",
  "defaultsecret",
] as const;

const MIN_HEX_SECRET_LENGTH = 64;
const MIN_ENCODED_SECRET_LENGTH = 43;
const MIN_SECRET_UNIQUE_CHARACTERS = 12;
const MIN_ESTIMATED_SECRET_BITS = 180;
const SUPABASE_PROJECT_REF = /^[a-z0-9]{20}$/;
const SUPAVISOR_HOST = /(?:^|\.)pooler\.supabase\.com$/;

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
  expectedRole: string,
): void {
  const candidate = value(env, variable);
  if (!candidate) return;
  try {
    const parsed = new URL(candidate);
    const protocol = parsed.protocol;
    const hostname = parsed.hostname.toLowerCase();
    const database = parsed.pathname.replace(/^\/+/, "");
    const usernamePrefix = `${expectedRole}.`;
    const projectRef = parsed.username.startsWith(usernamePrefix)
      ? parsed.username.slice(usernamePrefix.length)
      : "";
    const localHost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local");
    if (
      (protocol !== "postgres:" && protocol !== "postgresql:") ||
      !SUPAVISOR_HOST.test(hostname) ||
      parsed.port !== "5432" ||
      database !== "postgres" ||
      !parsed.password ||
      !SUPABASE_PROJECT_REF.test(projectRef) ||
      localHost ||
      parsed.searchParams.size !== 1 ||
      parsed.searchParams.get("sslmode") !== "require"
    ) {
      issues.push({ code: "invalid_url", variable });
    }
  } catch {
    issues.push({ code: "invalid_url", variable });
  }
}

/**
 * This is a release guard, not an entropy oracle. It accepts the documented
 * `openssl rand -hex 32` shape and similarly dense non-hex encodings of at
 * least 32 random bytes, while rejecting obvious placeholders and repetition.
 */
function isStrongReleaseSecret(candidate: string): boolean {
  const normalized = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (
    PLACEHOLDER_SECRET_MARKERS.some((marker) => normalized.includes(marker)) ||
    /^(.{1,16})\1+$/.test(candidate)
  ) {
    return false;
  }

  const hex = /^[0-9a-f]+$/i.test(candidate);
  if (candidate.length < (hex ? MIN_HEX_SECRET_LENGTH : MIN_ENCODED_SECRET_LENGTH)) {
    return false;
  }

  const counts = new Map<string, number>();
  for (const character of candidate) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  if (counts.size < MIN_SECRET_UNIQUE_CHARACTERS) return false;

  const estimatedBits = [...counts.values()].reduce((bits, count) => {
    const probability = count / candidate.length;
    return bits - probability * Math.log2(probability) * candidate.length;
  }, 0);
  return estimatedBits >= MIN_ESTIMATED_SECRET_BITS;
}

function pushWeakSecrets(
  issues: RuntimeConfigIssue[],
  env: RuntimeEnvironment,
  variables: readonly string[],
): void {
  for (const variable of variables) {
    const candidate = value(env, variable);
    if (candidate && !isStrongReleaseSecret(candidate)) {
      issues.push({ code: "weak_secret", variable });
    }
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
    pushInvalidPostgresUrl(
      issues,
      env,
      "DATABASE_URL",
      "causent_recompute_worker",
    );
    pushWeakSecrets(issues, env, ["CAUSENT_RECOMPUTE_SECRET"]);
    return { ok: issues.length === 0, production: true, issues };
  }
  if (target === "resolver") {
    const issues: RuntimeConfigIssue[] = [];
    pushMissing(issues, env, RESOLVER_RELEASE_REQUIRED_ENV);
    pushInvalidPostgresUrl(
      issues,
      env,
      "DATABASE_URL",
      "causent_resolve_worker",
    );
    pushWeakSecrets(issues, env, ["CAUSENT_RESOLVE_SECRET"]);
    return { ok: issues.length === 0, production: true, issues };
  }
  if (target === "drift") {
    const issues: RuntimeConfigIssue[] = [];
    pushMissing(issues, env, DRIFT_RELEASE_REQUIRED_ENV);
    pushInvalidPostgresUrl(
      issues,
      env,
      "DATABASE_URL",
      "causent_drift_worker",
    );
    pushWeakSecrets(issues, env, ["CAUSENT_DRIFT_SECRET"]);
    return { ok: issues.length === 0, production: true, issues };
  }

  const runtime = validateProductionAppRuntime({
    ...env,
    VERCEL_ENV: "production",
  });
  const issues = [...runtime.issues];
  pushMissing(issues, env, APP_RELEASE_REQUIRED_ENV);
  pushInvalidHttpsUrl(issues, env, "CAUSENT_DRIFT_URL");
  pushInvalidHttpsUrl(issues, env, "CAUSENT_RECOMPUTE_URL");
  pushInvalidHttpsUrl(issues, env, "CAUSENT_RESOLVE_URL");
  pushWeakSecrets(issues, env, APP_RELEASE_SECRET_ENV);
  return { ok: issues.length === 0, production: true, issues };
}
