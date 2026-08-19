import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const contractSource = await readFile(new URL("./contract.js", import.meta.url), "utf8");
const contract = await import(
  `data:text/javascript;base64,${Buffer.from(contractSource).toString("base64")}`
);
const {
  ACTIVE_WORKSPACE_COOKIE,
  PROFILE_SESSION_CAPACITY,
  PROFILE_SESSION_MIN_VALIDITY_MS,
  SESSION_ALLOCATION_POLICY,
  hasDocumentBody,
  isProtectedDocumentResponse,
  isSuccessfulStatus,
  parseAdversarialControl,
  parseCookieHeader,
  parseSessionCookiePoolEnvelope,
  redirectsToLogin,
  requireSessionPoolCapacity,
  sessionCookieHeaderForVu,
  validateSessionPoolBrokerConfig,
} = contract;

function stableUuid(seed, discriminator) {
  let hash = discriminator;
  for (const character of String(seed)) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  return `00000000-0000-4000-8000-${hash.toString(16).padStart(12, "0")}`;
}

function base64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sessionIdentity(id) {
  return {
    authSessionId: stableUuid(id, 2166136261),
    subjectId: stableUuid(id, 2246822507),
  };
}

function sessionHeader(id) {
  const identity = sessionIdentity(id);
  const accessToken = [
    base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    base64Url(JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 14_400,
      session_id: identity.authSessionId,
      sub: identity.subjectId,
    })),
    "test-signature",
  ].join(".");
  const serialized = JSON.stringify({
    access_token: accessToken,
    expires_at: Math.floor(Date.now() / 1000) + 14_400,
    refresh_token: `refresh-${id}`,
    token_type: "bearer",
  });
  return `sb-project-auth-token=base64-${base64Url(serialized)}; preference=compact`;
}

function sessionPoolEnvelope(profile, leaseId, count, overrides = {}) {
  const now = Date.now();
  const allocationSetId = leaseId.slice(0, leaseId.lastIndexOf(":"));
  return {
    version: 1,
    profile,
    allocationSetId,
    allocationPolicy: SESSION_ALLOCATION_POLICY,
    leaseId,
    issuedAt: new Date(now - 30_000).toISOString(),
    expiresAt: new Date(
      now + PROFILE_SESSION_MIN_VALIDITY_MS[profile] + 60_000,
    ).toISOString(),
    sessions: Array.from({ length: count }, (_, index) => {
      const identity = sessionIdentity(`${profile}-${index}`);
      return {
        id: `${leaseId}:vu-${index + 1}:${identity.authSessionId}`,
        authSessionId: identity.authSessionId,
        subjectId: identity.subjectId,
        cookieHeader: sessionHeader(`${profile}-${index}`),
      };
    }),
    ...overrides,
  };
}

function runPreflight(profile, env) {
  return spawnSync(process.execPath, [
    new URL("./session-pool-preflight.mjs", import.meta.url).pathname,
    profile,
  ], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("expired and invalid sessions cannot pass as protected documents", () => {
  const directRedirect = {
    status: 307,
    body: "",
    url: "https://staging.example.test/actions",
    headers: { Location: "/login" },
  };
  const followedRedirect = {
    status: 200,
    body: "<html>Continue with Google</html>",
    url: "https://staging.example.test/login",
    headers: {},
  };

  assert.equal(redirectsToLogin(directRedirect), true);
  assert.equal(redirectsToLogin(followedRedirect), true);
  assert.equal(isProtectedDocumentResponse(directRedirect), false);
  assert.equal(isProtectedDocumentResponse(followedRedirect), false);
});

test("only a non-empty 2xx protected response passes", () => {
  const response = {
    status: 200,
    body: "<html>Causent actions</html>",
    url: "https://staging.example.test/actions",
    headers: {},
  };

  assert.equal(isSuccessfulStatus(response), true);
  assert.equal(hasDocumentBody(response), true);
  assert.equal(isProtectedDocumentResponse(response), true);
  assert.equal(isProtectedDocumentResponse({ ...response, status: 401 }), false);
  assert.equal(isProtectedDocumentResponse({ ...response, body: "" }), false);
});

test("session cookies remain separate and preserve values containing equals signs", () => {
  assert.deepEqual(
    parseCookieHeader("sb-project-auth-token=base64-part==; preference=compact"),
    [
      { name: "sb-project-auth-token", value: "base64-part==" },
      { name: "preference", value: "compact" },
    ],
  );
});

test("broker configuration requires non-local HTTPS and a strong token", () => {
  const token = "B6zfS1cpX_g4-N9Jk2QrVm8aL0uH5wYeT7iCo3PdF4s";
  assert.equal(
    validateSessionPoolBrokerConfig({
      token,
      url: "https://session-pool.staging.example.test/lease",
    }),
    "https://session-pool.staging.example.test/lease",
  );

  for (const config of [
    { token, url: "http://session-pool.staging.example.test/lease" },
    { token, url: "https://localhost/lease" },
    { token, url: "https://user:password@session-pool.staging.example.test/lease" },
    { token: "x", url: "https://session-pool.staging.example.test/lease" },
    { token: "a".repeat(64), url: "https://session-pool.staging.example.test/lease" },
  ]) {
    assert.throws(() => validateSessionPoolBrokerConfig(config));
  }
});

test("session pool envelope is fresh, profile-bound, and lease-namespaced", () => {
  const profile = "smoke";
  const leaseId = "github:123:1:smoke";
  const allocationSetId = "github:123:1";
  const envelope = sessionPoolEnvelope(profile, leaseId, 1);
  assert.deepEqual(
    parseSessionCookiePoolEnvelope(JSON.stringify(envelope), { profile, leaseId, allocationSetId }),
    [sessionHeader("smoke-0")],
  );

  assert.throws(
    () => parseSessionCookiePoolEnvelope(JSON.stringify(envelope), {
      profile: "burst",
      leaseId: "github:123:1:burst",
      allocationSetId,
    }),
    /does not match the requested lease/,
  );
  assert.throws(
    () => parseSessionCookiePoolEnvelope(JSON.stringify({
      ...envelope,
      sessions: [{ ...envelope.sessions[0], id: "github:123:1:other:session-0" }],
    }), { profile, leaseId, allocationSetId }),
    /bind one requested lease and VU/,
  );
  assert.throws(
    () => parseSessionCookiePoolEnvelope(JSON.stringify({
      ...envelope,
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    }), { profile, leaseId, allocationSetId }),
    /stale or expires before/,
  );
});

test("session pool envelope rejects duplicate identities and auth sessions", () => {
  const profile = "adversarial";
  const leaseId = "github:456:1:adversarial";
  const allocationSetId = "github:456:1";
  const base = sessionPoolEnvelope(
    profile,
    leaseId,
    PROFILE_SESSION_CAPACITY.adversarial,
  );
  const duplicateIdentitySessions = base.sessions.map((session) => ({ ...session }));
  duplicateIdentitySessions[1].id = duplicateIdentitySessions[0].id;
  const duplicateAuthSessions = base.sessions.map((session) => ({ ...session }));
  duplicateAuthSessions[1] = {
    ...duplicateAuthSessions[1],
    authSessionId: duplicateAuthSessions[0].authSessionId,
    subjectId: duplicateAuthSessions[0].subjectId,
    cookieHeader: duplicateAuthSessions[0].cookieHeader,
    id: `${leaseId}:vu-2:${duplicateAuthSessions[0].authSessionId}`,
  };

  assert.throws(
    () => parseSessionCookiePoolEnvelope(JSON.stringify({
      ...base,
      sessions: duplicateIdentitySessions,
    }), { profile, leaseId, allocationSetId }),
    /bind one requested lease and VU/,
  );
  assert.throws(
    () => parseSessionCookiePoolEnvelope(JSON.stringify({
      ...base,
      sessions: duplicateAuthSessions,
    }), { profile, leaseId, allocationSetId }),
    /Every VU must use a distinct Supabase session/,
  );
});

test("session identities are bound to one profile lease", () => {
  const profile = "steady";
  const leaseId = "github:654:2:steady";
  const allocationSetId = "github:654:2";
  const envelope = sessionPoolEnvelope(
    profile,
    leaseId,
    PROFILE_SESSION_CAPACITY.steady,
  );
  envelope.sessions[0].id = `github:654:2:burst:vu-1:${envelope.sessions[0].authSessionId}`;

  assert.throws(
    () => parseSessionCookiePoolEnvelope(
      JSON.stringify(envelope),
      { profile, leaseId, allocationSetId },
    ),
    /bind one requested lease and VU/,
  );
});

test("every possible VU maps to one distinct pool entry without reuse", () => {
  const pool = [sessionHeader("one"), sessionHeader("two")];
  assert.equal(sessionCookieHeaderForVu(pool, 1), pool[0]);
  assert.equal(sessionCookieHeaderForVu(pool, 2), pool[1]);
  assert.throws(() => sessionCookieHeaderForVu(pool, 0));
  assert.throws(() => sessionCookieHeaderForVu(pool, 3));

  assert.equal(PROFILE_SESSION_CAPACITY.burst, 1200);
  assert.doesNotThrow(() => requireSessionPoolCapacity(new Array(400), "steady"));
  assert.throws(
    () => requireSessionPoolCapacity(new Array(399), "steady"),
    /requires 400 distinct sessions/,
  );
});

test("adversarial control uses a separate owner session and a real foreign workspace", () => {
  const workspaceId = "22222222-2222-4222-8222-222222222222";
  const control = parseAdversarialControl({
    cookieHeader: `${sessionHeader("foreign")}; ${ACTIVE_WORKSPACE_COOKIE}=11111111-1111-4111-8111-111111111111`,
    marker: "  FOREIGN-TENANT-ALPHA  ",
    workspaceId,
  }, [sessionHeader("load-user")]);

  assert.equal(control.marker, "FOREIGN-TENANT-ALPHA");
  assert.equal(control.workspaceId, workspaceId);
  assert.match(control.cookieHeader, new RegExp(`${ACTIVE_WORKSPACE_COOKIE}=${workspaceId}$`));
  assert.doesNotMatch(control.cookieHeader, /11111111-1111-4111-8111-111111111111/);

  assert.throws(() => parseAdversarialControl({
    cookieHeader: sessionHeader("load-user"),
    marker: "FOREIGN-TENANT-ALPHA",
    workspaceId,
  }, [sessionHeader("load-user")]), /outside the load-user pool/);
  assert.throws(() => parseAdversarialControl({
    cookieHeader: sessionHeader("foreign"),
    marker: "short",
    workspaceId,
  }));
  assert.throws(() => parseAdversarialControl({
    cookieHeader: sessionHeader("foreign"),
    marker: "FOREIGN-TENANT-ALPHA",
    workspaceId: "00000000-0000-0000-0000-000000000000",
  }));
});

test("load probe workspace cookie matches the application contract", async () => {
  assert.equal(ACTIVE_WORKSPACE_COOKIE, "causent_active_workspace");

  const appContract = await readFile(
    new URL("../lib/auth/workspace-context.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    appContract,
    /export const ACTIVE_WORKSPACE_COOKIE = "causent_active_workspace";/,
  );
});

test("k6 harness isolates VU sessions and grounds the adversarial marker", async () => {
  const harness = await readFile(new URL("./causent-mvp.js", import.meta.url), "utf8");

  assert.match(harness, /redirects: 0,/);
  assert.match(harness, /export function setup\(\)/);
  assert.match(harness, /if \(!adversarialControl\) return;/);
  assert.match(harness, /foreign_tenant_positive_control/);
  assert.match(harness, /String\(response\.body\)\.includes\(adversarialControl\.marker\)/);
  assert.match(harness, /new SharedArray\("causent-session-cookie-pool"/);
  assert.match(
    harness,
    /new SharedArray\("causent-session-cookie-pool", \(\) => \{\s+const rawSessionCookiePool = open\(sessionCookiePoolFile\);/,
  );
  assert.match(harness, /parseSessionCookiePoolEnvelope\(rawSessionCookiePool/);
  assert.match(harness, /sessionCookieHeaderForVu\(sessionCookiePool, __VU\)/);
  assert.match(harness, /noCookiesReset: true/);
  assert.match(harness, /protected_auth_failures: \["rate==0"\]/);
  assert.match(harness, /tenant_isolation_leaks: \["rate==0"\]/);
  assert.match(harness, /authFailures\.add\(!isProtectedDocumentResponse\(response\)\)/);
  assert.match(harness, /tenantIsolationLeaks\.add\(leaked\)/);
  assert.match(harness, /if \(sessionCookiesSeeded \|\| sessionCookiePool\.length === 0\) return;/);
  assert.match(harness, /sessionCookiesSeeded = true;/);
  assert.doesNotMatch(harness, /cookiesForURL\(baseUrl\)/);
  assert.doesNotMatch(harness, /CAUSENT_LOAD_SESSION_COOKIE\b/);
  assert.doesNotMatch(harness, /SESSION_COOKIE_POOLS_JSON/);
  assert.doesNotMatch(harness, /__VU\s*%\s*sessionCookiePool\.length/);
});

test("broker preflight rejects weak credentials without logging them", () => {
  const strongToken = "B6zfS1cpX_g4-N9Jk2QrVm8aL0uH5wYeT7iCo3PdF4s";
  const accepted = runPreflight("--broker", {
    CAUSENT_LOAD_SESSION_POOL_URL: "https://session-pool.staging.example.test/lease",
    CAUSENT_LOAD_SESSION_POOL_TOKEN: strongToken,
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /staging_load_broker_valid/);
  assert.equal(accepted.stdout.includes(strongToken), false);

  const result = runPreflight("--broker", {
    CAUSENT_LOAD_SESSION_POOL_URL: "https://session-pool.staging.example.test/lease",
    CAUSENT_LOAD_SESSION_POOL_TOKEN: "weak-broker-token",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /strong secret/);
  assert.equal(result.stderr.includes("weak-broker-token"), false);
});

test("session-pool preflight fails closed on an undersized profile", async () => {
  const profile = "steady";
  const leaseId = "github:789:1:steady";
  const tempDirectory = await mkdtemp(join(tmpdir(), "causent-load-test-"));
  const poolFile = join(tempDirectory, "pool.json");
  await writeFile(poolFile, JSON.stringify(sessionPoolEnvelope(profile, leaseId, 1)));
  try {
    const result = runPreflight(profile, {
      CAUSENT_LOAD_SESSION_COOKIE_POOL_FILE: poolFile,
      CAUSENT_LOAD_SESSION_COOKIE_POOL_SET: "github:789:1",
      CAUSENT_LOAD_SESSION_COOKIE_POOL_LEASE: leaseId,
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /exactly 400 sessions/);
    assert.equal(result.stderr.includes("session-steady-0"), false);
  } finally {
    await rm(tempDirectory, { recursive: true });
  }
});

test("adversarial preflight requires and validates its positive control", async () => {
  const profile = "adversarial";
  const leaseId = "github:987:1:adversarial";
  const tempDirectory = await mkdtemp(join(tmpdir(), "causent-load-test-"));
  const poolFile = join(tempDirectory, "pool.json");
  await writeFile(poolFile, JSON.stringify(sessionPoolEnvelope(
    profile,
    leaseId,
    PROFILE_SESSION_CAPACITY.adversarial,
  )));
  try {
    const result = runPreflight(profile, {
      CAUSENT_LOAD_SESSION_COOKIE_POOL_FILE: poolFile,
      CAUSENT_LOAD_SESSION_COOKIE_POOL_SET: "github:987:1",
      CAUSENT_LOAD_SESSION_COOKIE_POOL_LEASE: leaseId,
      CAUSENT_LOAD_FOREIGN_SESSION_COOKIE: sessionHeader("foreign-control"),
      CAUSENT_LOAD_FORBIDDEN_TENANT_MARKER: "FOREIGN-TENANT-ALPHA",
      CAUSENT_LOAD_FORBIDDEN_WORKSPACE_ID: "22222222-2222-4222-8222-222222222222",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"profile":"adversarial","sessions":50/);
    assert.equal(result.stdout.includes("foreign-control"), false);
  } finally {
    await rm(tempDirectory, { recursive: true });
  }
});

test("workflow labels profile-only success separately from the complete release gate", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/staging-load.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /complete_gate=true/);
  assert.match(workflow, /complete_gate=false/);
  assert.match(
    workflow,
    /matrix='\{"profile":\["steady","burst","hot_workspace","mixed_write","soak","adversarial"\]\}'/,
  );
  assert.match(
    workflow,
    /Complete release gate passed: steady, burst, hot_workspace, mixed_write, soak, and adversarial\./,
  );
  assert.match(workflow, /'Staging release gate' \|\| 'Selected staging load profile'/);
  assert.match(workflow, /This is not complete release-gate evidence\./);
  assert.match(workflow, /if \[ "\$LOAD_PROFILE" = mixed_write \]; then/);
  assert.match(workflow, /CAUSENT_STAGING_SESSION_POOL_URL/);
  assert.match(workflow, /CAUSENT_STAGING_SESSION_POOL_TOKEN/);
  assert.match(workflow, /node load\/session-pool-preflight\.mjs --broker/);
  assert.match(workflow, /umask 077/);
  assert.match(workflow, /mktemp -d "\$RUNNER_TEMP\/causent-session-pool-\$LOAD_PROFILE\.XXXXXX"/);
  assert.match(workflow, /pool_set="github:\$GITHUB_RUN_ID:\$GITHUB_RUN_ATTEMPT"/);
  assert.match(workflow, /pool_lease="\$pool_set:\$LOAD_PROFILE"/);
  assert.match(workflow, /single-use-supabase-session-per-vu-profile-disjoint-v1/);
  assert.match(workflow, /chmod 600 "\$pool_file"/);
  assert.match(workflow, /--header "@\$pool_header_file"/);
  assert.match(workflow, /--output "\$pool_file"/);
  assert.match(workflow, /CAUSENT_LOAD_SESSION_COOKIE_POOL_FILE=\$pool_file/);
  assert.match(workflow, /CAUSENT_LOAD_SESSION_COOKIE_POOL_SET="\$pool_set"/);
  assert.match(workflow, /node load\/session-pool-preflight\.mjs "\$LOAD_PROFILE"/);
  assert.match(workflow, /mkdir -p load\/results\s+k6 run load\/causent-mvp\.js/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(workflow, /CAUSENT_STAGING_FOREIGN_SESSION_COOKIE/);
  assert.match(workflow, /CAUSENT_STAGING_FORBIDDEN_TENANT_MARKER/);
  assert.match(workflow, /CAUSENT_STAGING_FORBIDDEN_WORKSPACE_ID/);
  assert.doesNotMatch(workflow, /CAUSENT_STAGING_SESSION_COOKIE\b/);
  assert.doesNotMatch(workflow, /SESSION_COOKIE_POOLS_JSON/);
  assert.doesNotMatch(workflow, /Authorization: Bearer \$CAUSENT_LOAD_SESSION_POOL_TOKEN.*curl/);
});
