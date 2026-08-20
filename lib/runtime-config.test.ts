import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PRODUCTION_FORBIDDEN_LOCAL_FLAGS,
  isProductionDeployment,
  validateProductionAppRuntime,
  validateReleaseConfig,
  type RuntimeEnvironment,
} from "./runtime-config.ts";

const validProductionApp: RuntimeEnvironment = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "private-service-role-key",
};

const strongHexSecret =
  "70cb4c9d2f8a1365e1b9670df24a58c3d960be14f75ac8923e0d6b71c4fa8532";
const strongBase64UrlSecret = "B6zfS1cpX_g4-N9Jk2QrVm8aL0uH5wYeT7iCo3PdF4s";
const projectRef = "abcdefghijklmnopqrst";
const driftDatabaseUrl =
  `postgresql://causent_drift_worker.${projectRef}:strong-db-password@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require`;
const recomputeDatabaseUrl =
  `postgresql://causent_recompute_worker.${projectRef}:strong-db-password@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require`;
const resolveDatabaseUrl =
  `postgresql://causent_resolve_worker.${projectRef}:strong-db-password@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require`;

test("development and Vercel previews preserve local behavior", () => {
  assert.deepEqual(validateProductionAppRuntime({ NODE_ENV: "development" }), {
    ok: true,
    production: false,
    issues: [],
  });
  assert.equal(
    isProductionDeployment({ NODE_ENV: "production", VERCEL_ENV: "preview" }),
    false,
  );
  assert.equal(
    validateProductionAppRuntime({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      CAUSENT_LOCAL_DEMO: "1",
    }).ok,
    true,
  );
});

test("production requires Supabase auth and the server-only receipt capability", () => {
  const result = validateProductionAppRuntime({ NODE_ENV: "production" });
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.map((issue) => issue.variable).sort(),
    [
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ],
  );
  assert.equal(validateProductionAppRuntime(validProductionApp).ok, true);
});

test("every local-only flag must be absent in production", () => {
  for (const variable of PRODUCTION_FORBIDDEN_LOCAL_FLAGS) {
    const result = validateProductionAppRuntime({
      ...validProductionApp,
      [variable]: "0",
    });
    assert.deepEqual(result.issues, [
      { code: "forbidden_production_flag", variable },
    ]);
  }
});

test("production Supabase and worker URLs must be HTTPS", () => {
  const runtime = validateProductionAppRuntime({
    ...validProductionApp,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  });
  assert.deepEqual(runtime.issues, [
    { code: "invalid_url", variable: "NEXT_PUBLIC_SUPABASE_URL" },
  ]);

  const release = validateReleaseConfig("app", {
    ...validProductionApp,
    CAUSENT_DRIFT_URL: "http://drift.example/api/drift",
    CAUSENT_DRIFT_SECRET: strongHexSecret,
    CAUSENT_RECOMPUTE_URL: "http://worker.example/api/recompute",
    CAUSENT_RECOMPUTE_SECRET: strongHexSecret,
    CAUSENT_RESOLVE_URL: "https://resolver.example/api/resolve",
    CAUSENT_RESOLVE_SECRET: strongHexSecret,
    CRON_SECRET: strongHexSecret,
  });
  assert.deepEqual(release.issues, [
    { code: "invalid_url", variable: "CAUSENT_DRIFT_URL" },
    { code: "invalid_url", variable: "CAUSENT_RECOMPUTE_URL" },
  ]);
});

test("release checks cover the app and all three stateful workers", () => {
  const app = validateReleaseConfig("app", validProductionApp);
  assert.deepEqual(
    app.issues.map((issue) => issue.variable).sort(),
    [
      "CAUSENT_DRIFT_SECRET",
      "CAUSENT_DRIFT_URL",
      "CAUSENT_RECOMPUTE_SECRET",
      "CAUSENT_RECOMPUTE_URL",
      "CAUSENT_RESOLVE_SECRET",
      "CAUSENT_RESOLVE_URL",
      "CRON_SECRET",
    ],
  );
  assert.equal(
    validateReleaseConfig("app", {
      ...validProductionApp,
      CAUSENT_DRIFT_URL: "https://causent-drift.vercel.app/api/drift",
      CAUSENT_DRIFT_SECRET: strongHexSecret,
      CAUSENT_RECOMPUTE_URL: "https://causent-recompute.vercel.app/api/recompute",
      CAUSENT_RECOMPUTE_SECRET: strongBase64UrlSecret,
      CAUSENT_RESOLVE_URL: "https://causent-resolve.vercel.app/api/resolve",
      CAUSENT_RESOLVE_SECRET: strongHexSecret,
      CRON_SECRET: strongBase64UrlSecret,
    }).ok,
    true,
  );

  assert.deepEqual(validateReleaseConfig("worker", {}).issues, [
    { code: "missing_required", variable: "DATABASE_URL" },
    { code: "missing_required", variable: "CAUSENT_RECOMPUTE_SECRET" },
  ]);
  assert.equal(
    validateReleaseConfig("worker", {
      DATABASE_URL: recomputeDatabaseUrl,
      CAUSENT_RECOMPUTE_SECRET: strongHexSecret,
    }).ok,
    true,
  );

  assert.deepEqual(validateReleaseConfig("resolver", {}).issues, [
    { code: "missing_required", variable: "DATABASE_URL" },
    { code: "missing_required", variable: "CAUSENT_RESOLVE_SECRET" },
  ]);
  assert.equal(
    validateReleaseConfig("resolver", {
      DATABASE_URL: resolveDatabaseUrl,
      CAUSENT_RESOLVE_SECRET: strongBase64UrlSecret,
    }).ok,
    true,
  );

  assert.deepEqual(validateReleaseConfig("drift", {}).issues, [
    { code: "missing_required", variable: "DATABASE_URL" },
    { code: "missing_required", variable: "CAUSENT_DRIFT_SECRET" },
  ]);
  assert.equal(
    validateReleaseConfig("drift", {
      DATABASE_URL: driftDatabaseUrl,
      CAUSENT_DRIFT_SECRET: strongHexSecret,
    }).ok,
    true,
  );
});

test("worker database URLs reject malformed and local release targets", () => {
  for (const databaseUrl of [
    "postgresql://",
    "postgresql:garbage",
    `postgresql://causent_drift_worker.${projectRef}:password@127.0.0.1:5432/postgres?sslmode=require`,
    `postgresql://causent_drift_worker.${projectRef}:password@localhost:5432/postgres?sslmode=require`,
    `postgresql://causent_drift_worker.${projectRef}:password@pooler.example:5432/postgres?sslmode=require`,
    `postgresql://causent_drift_worker.${projectRef}@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require`,
    `postgresql://causent_drift_worker.${projectRef}:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`,
    `postgresql://causent_drift_worker.${projectRef}:password@aws-0-us-east-1.pooler.supabase.com:5432/other?sslmode=require`,
    `postgresql://causent_drift_worker.${projectRef}:password@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
    `postgresql://causent_drift_worker.${projectRef}:password@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=disable`,
    `postgresql://causent_drift_worker.${projectRef}:password@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require&application_name=worker`,
  ]) {
    assert.deepEqual(
      validateReleaseConfig("drift", {
        DATABASE_URL: databaseUrl,
        CAUSENT_DRIFT_SECRET: strongHexSecret,
      }).issues,
      [{ code: "invalid_url", variable: "DATABASE_URL" }],
    );
  }
});

test("every worker target requires its exact Supavisor role", () => {
  const targets = [
    {
      target: "drift" as const,
      role: "causent_drift_worker",
      secretName: "CAUSENT_DRIFT_SECRET",
    },
    {
      target: "worker" as const,
      role: "causent_recompute_worker",
      secretName: "CAUSENT_RECOMPUTE_SECRET",
    },
    {
      target: "resolver" as const,
      role: "causent_resolve_worker",
      secretName: "CAUSENT_RESOLVE_SECRET",
    },
  ];

  for (const { role, secretName, target } of targets) {
    const env = {
      DATABASE_URL: `postgresql://${role}.${projectRef}:strong-db-password@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require`,
      [secretName]: strongHexSecret,
    };
    assert.equal(validateReleaseConfig(target, env).ok, true);

    for (const rejectedUsername of [
      `postgres.${projectRef}`,
      `service_role.${projectRef}`,
      `causent_worker.${projectRef}`,
      `causent_drift_worker.${projectRef}`,
      `causent_recompute_worker.${projectRef}`,
      `causent_resolve_worker.${projectRef}`,
      role,
      `${role}.shortref`,
    ].filter((username) => username !== `${role}.${projectRef}`)) {
      assert.deepEqual(
        validateReleaseConfig(target, {
          ...env,
          DATABASE_URL: `postgresql://${rejectedUsername}:strong-db-password@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require`,
        }).issues,
        [{ code: "invalid_url", variable: "DATABASE_URL" }],
      );
    }
  }
});

test("release secrets require cryptographic strength", () => {
  for (const secret of [
    "x",
    "changeme",
    "a".repeat(64),
    "abc123".repeat(12),
    "this-is-a-placeholder-secret-value-that-is-not-random",
    "this-is-a-very-long-password-that-should-never-pass-the-release-gate-1234",
    "0123456789abcdef0123456789abcdef",
  ]) {
    assert.deepEqual(
      validateReleaseConfig("worker", {
        DATABASE_URL: recomputeDatabaseUrl,
        CAUSENT_RECOMPUTE_SECRET: secret,
      }).issues,
      [{ code: "weak_secret", variable: "CAUSENT_RECOMPUTE_SECRET" }],
    );
  }

  for (const secret of [strongHexSecret, strongBase64UrlSecret]) {
    assert.equal(
      validateReleaseConfig("worker", {
        DATABASE_URL: recomputeDatabaseUrl,
        CAUSENT_RECOMPUTE_SECRET: secret,
      }).ok,
      true,
    );
  }
});

test("app release checks every protected shared secret", () => {
  const app: RuntimeEnvironment = {
    ...validProductionApp,
    CAUSENT_DRIFT_URL: "https://causent-drift.vercel.app/api/drift",
    CAUSENT_DRIFT_SECRET: strongHexSecret,
    CAUSENT_RECOMPUTE_URL: "https://causent-recompute.vercel.app/api/recompute",
    CAUSENT_RECOMPUTE_SECRET: strongHexSecret,
    CAUSENT_RESOLVE_URL: "https://causent-resolve.vercel.app/api/resolve",
    CAUSENT_RESOLVE_SECRET: strongHexSecret,
    CRON_SECRET: strongHexSecret,
  };

  for (const variable of [
    "CAUSENT_DRIFT_SECRET",
    "CAUSENT_RECOMPUTE_SECRET",
    "CAUSENT_RESOLVE_SECRET",
    "CRON_SECRET",
  ]) {
    assert.deepEqual(validateReleaseConfig("app", { ...app, [variable]: "x" }).issues, [
      { code: "weak_secret", variable },
    ]);
  }
});

test("validation output never includes secret values", () => {
  const secret = "do-not-log-this-secret-value-even-when-it-is-rejected";
  const result = validateReleaseConfig("worker", {
    DATABASE_URL: recomputeDatabaseUrl,
    CAUSENT_RECOMPUTE_SECRET: secret,
  });
  assert.equal(JSON.stringify(result).includes(secret), false);
});
