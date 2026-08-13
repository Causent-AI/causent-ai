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

test("production Supabase and recompute URLs must be HTTPS", () => {
  const runtime = validateProductionAppRuntime({
    ...validProductionApp,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  });
  assert.deepEqual(runtime.issues, [
    { code: "invalid_url", variable: "NEXT_PUBLIC_SUPABASE_URL" },
  ]);

  const release = validateReleaseConfig("app", {
    ...validProductionApp,
    CAUSENT_RECOMPUTE_URL: "http://worker.example/api/recompute",
    CAUSENT_RECOMPUTE_SECRET: "worker-secret",
    CAUSENT_RESOLVE_URL: "https://resolver.example/api/resolve",
    CAUSENT_RESOLVE_SECRET: "resolver-secret",
    CRON_SECRET: "cron-secret",
  });
  assert.deepEqual(release.issues, [
    { code: "invalid_url", variable: "CAUSENT_RECOMPUTE_URL" },
  ]);
});

test("release checks cover the app and both stateful workers", () => {
  const app = validateReleaseConfig("app", validProductionApp);
  assert.deepEqual(
    app.issues.map((issue) => issue.variable).sort(),
    [
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
      CAUSENT_RECOMPUTE_URL: "https://causent-recompute.vercel.app/api/recompute",
      CAUSENT_RECOMPUTE_SECRET: "worker-secret",
      CAUSENT_RESOLVE_URL: "https://causent-resolve.vercel.app/api/resolve",
      CAUSENT_RESOLVE_SECRET: "resolver-secret",
      CRON_SECRET: "cron-secret",
    }).ok,
    true,
  );

  assert.deepEqual(validateReleaseConfig("worker", {}).issues, [
    { code: "missing_required", variable: "DATABASE_URL" },
    { code: "missing_required", variable: "CAUSENT_RECOMPUTE_SECRET" },
  ]);
  assert.equal(
    validateReleaseConfig("worker", {
      DATABASE_URL: "postgresql://pooler.example/postgres",
      CAUSENT_RECOMPUTE_SECRET: "worker-secret",
    }).ok,
    true,
  );

  assert.deepEqual(validateReleaseConfig("resolver", {}).issues, [
    { code: "missing_required", variable: "DATABASE_URL" },
    { code: "missing_required", variable: "CAUSENT_RESOLVE_SECRET" },
  ]);
  assert.equal(
    validateReleaseConfig("resolver", {
      DATABASE_URL: "postgresql://pooler.example/postgres",
      CAUSENT_RESOLVE_SECRET: "resolver-secret",
    }).ok,
    true,
  );
});

test("validation output never includes secret values", () => {
  const secret = "do-not-log-this-secret";
  const result = validateReleaseConfig("worker", {
    DATABASE_URL: secret,
    CAUSENT_RECOMPUTE_SECRET: secret,
  });
  assert.equal(JSON.stringify(result).includes(secret), false);
});
