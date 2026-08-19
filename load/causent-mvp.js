import http from "k6/http";
import { SharedArray } from "k6/data";
import { check, fail, sleep } from "k6";
import { Rate } from "k6/metrics";

import {
  ACTIVE_WORKSPACE_COOKIE,
  PROFILE_SESSION_CAPACITY,
  hasDocumentBody,
  isProtectedDocumentResponse,
  isSuccessfulStatus,
  parseAdversarialControl,
  parseCookieHeader,
  parseSessionCookiePoolEnvelope,
  redirectsToLogin,
  sessionCookieHeaderForVu,
} from "./contract.js";

const baseUrl = (__ENV.CAUSENT_LOAD_BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const profile = __ENV.CAUSENT_LOAD_PROFILE || "smoke";
const acknowledgement = "I_UNDERSTAND_STAGING_LOAD";
const localTarget = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(baseUrl);
const sessionCookiePoolFile = __ENV.CAUSENT_LOAD_SESSION_COOKIE_POOL_FILE || "";
const sessionCookiePoolSet = __ENV.CAUSENT_LOAD_SESSION_COOKIE_POOL_SET || "";
const sessionCookiePoolLease = __ENV.CAUSENT_LOAD_SESSION_COOKIE_POOL_LEASE || "";

if (__ENV.CAUSENT_LOAD_ACK !== acknowledgement) {
  throw new Error(`Set CAUSENT_LOAD_ACK=${acknowledgement} before generating load.`);
}
if (!localTarget && __ENV.CAUSENT_LOAD_ENV !== "staging") {
  throw new Error("Remote load targets require CAUSENT_LOAD_ENV=staging.");
}
if (!localTarget && !baseUrl.startsWith("https://")) {
  throw new Error("Remote load targets require HTTPS.");
}
if (!localTarget && (!sessionCookiePoolFile || !sessionCookiePoolSet || !sessionCookiePoolLease)) {
  throw new Error("Remote load targets require a validated session-cookie pool lease file.");
}
if (
  !localTarget &&
  profile === "soak" &&
  __ENV.CAUSENT_LOAD_SOAK_DURATION &&
  __ENV.CAUSENT_LOAD_SOAK_DURATION !== "2h"
) {
  throw new Error("The protected remote soak profile has a fixed two-hour lease contract.");
}

const readPaths = ["/data-workshop", "/reports", "/actions", "/impact"];
const authFailures = new Rate("protected_auth_failures");
const tenantIsolationLeaks = new Rate("tenant_isolation_leaks");

const sessionCookiePool = localTarget && !sessionCookiePoolFile
  ? []
  : new SharedArray("causent-session-cookie-pool", () => {
      const rawSessionCookiePool = open(sessionCookiePoolFile);
      const pool = parseSessionCookiePoolEnvelope(rawSessionCookiePool, {
        profile,
        allocationSetId: sessionCookiePoolSet,
        leaseId: sessionCookiePoolLease,
      });
      if (profile === "adversarial") {
        parseAdversarialControl({
          cookieHeader: __ENV.CAUSENT_LOAD_FOREIGN_SESSION_COOKIE,
          marker: __ENV.CAUSENT_LOAD_FORBIDDEN_TENANT_MARKER,
          workspaceId: __ENV.CAUSENT_LOAD_FORBIDDEN_WORKSPACE_ID,
        }, pool);
      }
      return pool;
    });

const adversarialControl = profile === "adversarial"
  ? parseAdversarialControl({
      cookieHeader: __ENV.CAUSENT_LOAD_FOREIGN_SESSION_COOKIE,
      marker: __ENV.CAUSENT_LOAD_FORBIDDEN_TENANT_MARKER,
      workspaceId: __ENV.CAUSENT_LOAD_FORBIDDEN_WORKSPACE_ID,
    })
  : null;

const profiles = {
  smoke: {
    executor: "shared-iterations",
    vus: PROFILE_SESSION_CAPACITY.smoke,
    iterations: 8,
    maxDuration: "1m",
    exec: "readJourney",
  },
  steady: {
    executor: "constant-arrival-rate",
    rate: 28,
    timeUnit: "1s",
    duration: "10m",
    preAllocatedVUs: 80,
    maxVUs: PROFILE_SESSION_CAPACITY.steady,
    exec: "readJourney",
  },
  burst: {
    executor: "ramping-arrival-rate",
    startRate: 28,
    timeUnit: "1s",
    preAllocatedVUs: 200,
    maxVUs: PROFILE_SESSION_CAPACITY.burst,
    stages: [
      { target: 280, duration: "1m" },
      { target: 280, duration: "2m" },
      { target: 28, duration: "2m" },
    ],
    exec: "readJourney",
  },
  hot_workspace: {
    executor: "constant-vus",
    vus: PROFILE_SESSION_CAPACITY.hot_workspace,
    duration: "10m",
    exec: "hotWorkspace",
  },
  mixed_write: {
    executor: "constant-arrival-rate",
    rate: 28,
    timeUnit: "1s",
    duration: "10m",
    preAllocatedVUs: 100,
    maxVUs: PROFILE_SESSION_CAPACITY.mixed_write,
    exec: "mixedReadWrite",
  },
  soak: {
    executor: "constant-arrival-rate",
    rate: 28,
    timeUnit: "1s",
    duration: __ENV.CAUSENT_LOAD_SOAK_DURATION || "2h",
    preAllocatedVUs: 80,
    maxVUs: PROFILE_SESSION_CAPACITY.soak,
    exec: "readJourney",
  },
  adversarial: {
    executor: "constant-vus",
    vus: PROFILE_SESSION_CAPACITY.adversarial,
    duration: "10m",
    exec: "adversarialTenant",
  },
};

if (!profiles[profile]) throw new Error(`Unknown CAUSENT_LOAD_PROFILE: ${profile}`);

export const options = {
  scenarios: { [profile]: profiles[profile] },
  thresholds: {
    checks: ["rate>0.99"],
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<2000", "p(99)<4000"],
    protected_auth_failures: ["rate==0"],
    ...(profile === "adversarial" ? { tenant_isolation_leaks: ["rate==0"] } : {}),
  },
  noCookiesReset: true,
  noConnectionReuse: false,
  userAgent: "causent-staging-load/1",
};

let selectedSessionVu = 0;
let selectedSessionCookies = [];
let sessionCookiesSeeded = false;

function sessionCookiesForCurrentVu() {
  if (sessionCookiePool.length === 0) return [];
  if (selectedSessionVu !== __VU) {
    selectedSessionCookies = parseCookieHeader(
      sessionCookieHeaderForVu(sessionCookiePool, __VU),
    );
    selectedSessionVu = __VU;
  }
  return selectedSessionCookies;
}

function seedSessionCookies() {
  if (sessionCookiesSeeded || sessionCookiePool.length === 0) return;
  const jar = http.cookieJar();
  for (const cookie of sessionCookiesForCurrentVu()) {
    jar.set(baseUrl, cookie.name, cookie.value, { path: "/" });
  }
  sessionCookiesSeeded = true;
}

function getPath(path) {
  seedSessionCookies();
  const response = http.get(`${baseUrl}${path}`, {
    redirects: 0,
    tags: { route: path },
  });
  authFailures.add(!isProtectedDocumentResponse(response));
  check(response, {
    [`${path} returns 2xx`]: isSuccessfulStatus,
    [`${path} remains authenticated`]: (result) => !redirectsToLogin(result),
    [`${path} returns a document`]: hasDocumentBody,
  });
  return response;
}

export function setup() {
  if (!adversarialControl) return;

  const response = http.get(`${baseUrl}/actions`, {
    headers: { Cookie: adversarialControl.cookieHeader },
    redirects: 0,
    tags: { route: "foreign_tenant_positive_control" },
  });
  if (
    !isProtectedDocumentResponse(response) ||
    !String(response.body).includes(adversarialControl.marker)
  ) {
    fail("Foreign-tenant positive control failed; isolation evidence would be invalid.");
  }
}

export function readJourney() {
  getPath(readPaths[__ITER % readPaths.length]);
  sleep(0.1);
}

export function hotWorkspace() {
  getPath(__ITER % 2 === 0 ? "/actions" : "/data-workshop");
  sleep(0.05);
}

export function mixedReadWrite() {
  if (__ITER % 5 !== 0) {
    readJourney();
    return;
  }
  seedSessionCookies();
  const writeUrl = __ENV.CAUSENT_LOAD_WRITE_URL;
  const writeSecret = __ENV.CAUSENT_LOAD_WRITE_SECRET;
  if (!writeUrl || !writeSecret) {
    fail("mixed_write requires a staging-only CAUSENT_LOAD_WRITE_URL and CAUSENT_LOAD_WRITE_SECRET");
  }
  const response = http.post(writeUrl, JSON.stringify({ sequence: `${__VU}:${__ITER}` }), {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${writeSecret}`,
    },
    tags: { route: "staging_write_probe" },
  });
  check(response, { "staging write succeeds": (result) => result.status >= 200 && result.status < 300 });
}

export function adversarialTenant() {
  seedSessionCookies();
  http.cookieJar().set(
    baseUrl,
    ACTIVE_WORKSPACE_COOKIE,
    adversarialControl.workspaceId,
    { path: "/" },
  );
  const response = getPath("/actions");
  const leaked = String(response.body).includes(adversarialControl.marker);
  tenantIsolationLeaks.add(leaked);
  check(response, {
    "forged workspace does not disclose the foreign tenant": () => !leaked,
  });
}

export function handleSummary(data) {
  return {
    stdout: `${JSON.stringify({ profile, metrics: data.metrics }, null, 2)}\n`,
    [`load/results/${profile}.json`]: JSON.stringify(data, null, 2),
  };
}
