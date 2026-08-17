import http from "k6/http";
import { check, fail, sleep } from "k6";

const baseUrl = (__ENV.CAUSENT_LOAD_BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const profile = __ENV.CAUSENT_LOAD_PROFILE || "smoke";
const acknowledgement = "I_UNDERSTAND_STAGING_LOAD";
const localTarget = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(baseUrl);

if (__ENV.CAUSENT_LOAD_ACK !== acknowledgement) {
  throw new Error(`Set CAUSENT_LOAD_ACK=${acknowledgement} before generating load.`);
}
if (!localTarget && __ENV.CAUSENT_LOAD_ENV !== "staging") {
  throw new Error("Remote load targets require CAUSENT_LOAD_ENV=staging.");
}

const readHeaders = __ENV.CAUSENT_LOAD_SESSION_COOKIE
  ? { Cookie: __ENV.CAUSENT_LOAD_SESSION_COOKIE }
  : {};
const readPaths = ["/data-workshop", "/reports", "/actions", "/impact"];

const profiles = {
  smoke: {
    executor: "shared-iterations",
    vus: 1,
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
    maxVUs: 400,
    exec: "readJourney",
  },
  burst: {
    executor: "ramping-arrival-rate",
    startRate: 28,
    timeUnit: "1s",
    preAllocatedVUs: 200,
    maxVUs: 1200,
    stages: [
      { target: 280, duration: "1m" },
      { target: 280, duration: "2m" },
      { target: 28, duration: "2m" },
    ],
    exec: "readJourney",
  },
  hot_workspace: {
    executor: "constant-vus",
    vus: 200,
    duration: "10m",
    exec: "hotWorkspace",
  },
  mixed_write: {
    executor: "constant-arrival-rate",
    rate: 28,
    timeUnit: "1s",
    duration: "10m",
    preAllocatedVUs: 100,
    maxVUs: 500,
    exec: "mixedReadWrite",
  },
  soak: {
    executor: "constant-arrival-rate",
    rate: 28,
    timeUnit: "1s",
    duration: __ENV.CAUSENT_LOAD_SOAK_DURATION || "2h",
    preAllocatedVUs: 80,
    maxVUs: 400,
    exec: "readJourney",
  },
  adversarial: {
    executor: "constant-vus",
    vus: 50,
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
  },
  noConnectionReuse: false,
  userAgent: "causent-staging-load/1",
};

function getPath(path, headers = readHeaders) {
  const response = http.get(`${baseUrl}${path}`, {
    headers,
    redirects: 3,
    tags: { route: path },
  });
  check(response, {
    [`${path} has no server failure`]: (result) => result.status < 500,
    [`${path} returns a document`]: (result) => typeof result.body === "string" && result.body.length > 0,
  });
  return response;
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
  const writeUrl = __ENV.CAUSENT_LOAD_WRITE_URL;
  const writeSecret = __ENV.CAUSENT_LOAD_WRITE_SECRET;
  if (!writeUrl || !writeSecret) {
    fail("mixed_write requires a staging-only CAUSENT_LOAD_WRITE_URL and CAUSENT_LOAD_WRITE_SECRET");
  }
  const response = http.post(writeUrl, JSON.stringify({ sequence: `${__VU}:${__ITER}` }), {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${writeSecret}`,
      ...readHeaders,
    },
    tags: { route: "staging_write_probe" },
  });
  check(response, { "staging write succeeds": (result) => result.status >= 200 && result.status < 300 });
}

export function adversarialTenant() {
  const response = getPath("/actions", { Cookie: "causent-active-workspace=00000000-0000-0000-0000-000000000000" });
  check(response, {
    "forged workspace does not disclose fixture data": (result) =>
      !String(result.body).includes("Gummy Alpha") && !String(result.body).includes("Northstar"),
  });
}

export function handleSummary(data) {
  return {
    stdout: `${JSON.stringify({ profile, metrics: data.metrics }, null, 2)}\n`,
    [`load/results/${profile}.json`]: JSON.stringify(data, null, 2),
  };
}
