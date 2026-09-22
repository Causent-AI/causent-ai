import assert from "node:assert/strict";
import test from "node:test";
import { dailyRange, syncRange, GA4_SCOPE, Ga4Error, GoogleAnalytics, metricSelection } from "./google.ts";
import { openToken, sealToken, stateHash } from "./crypto.ts";
import { ga4Config } from "./config.ts";

const config = { clientId: "test-client", clientSecret: "test-secret", redirectUri: "https://example.test/api/ga4/callback" };
const property = { id: "12345", name: "Test", timezone: "America/Los_Angeles" };
const range = { start: "2026-01-01", end: "2026-01-03" };
function response(rows: Array<[string, string]>, extra: Record<string, unknown> = {}) {
  return { dimensionHeaders: [{ name: "date" }], metricHeaders: [{ name: "sessions", type: "TYPE_INTEGER" }],
    metadata: { timeZone: property.timezone }, rowCount: rows.length,
    rows: rows.map(([date, value]) => ({ dimensionValues: [{ value: date }], metricValues: [{ value }] })), ...extra };
}
const mock = (body: unknown, status = 200): typeof fetch => async () => Response.json(body, { status });
const rejects = (code: Ga4Error["code"]) => (error: unknown) => error instanceof Ga4Error && error.code === code;

test("credential encryption binds the ciphertext to one workspace and connection", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const encrypted = sealToken("refresh-secret", key, "workspace:connection");
  assert.ok(!encrypted.includes("refresh-secret"));
  assert.equal(openToken(encrypted, key, "workspace:connection"), "refresh-secret");
  assert.throws(() => openToken(encrypted, key, "other:connection"));
  assert.throws(() => openToken(encrypted, Buffer.alloc(32, 8).toString("base64"), "workspace:connection"));
  assert.throws(() => sealToken("token", "short", "binding"));
  assert.notEqual(encrypted, sealToken("refresh-secret", key, "workspace:connection"));
  assert.equal(stateHash("state").length, 64);
});

test("authorization requests read-only offline consent with explicit identity and state", () => {
  const url = new URL(new GoogleAnalytics(config).authorizationUrl("nonce"));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("scope"), `${GA4_SCOPE} openid`);
  assert.equal(url.searchParams.get("state"), "nonce");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
});

test("completed daily windows use the property timezone across DST and UTC boundaries", () => {
  assert.deepEqual(dailyRange("America/Los_Angeles", 7, new Date("2026-03-09T01:00:00Z")), { start: "2026-03-01", end: "2026-03-07" });
  assert.deepEqual(dailyRange("Pacific/Kiritimati", 1, new Date("2026-01-01T12:00:00Z")), { start: "2026-01-01", end: "2026-01-01" });
  assert.throws(() => dailyRange("invalid/zone", 7));
  assert.throws(() => dailyRange("UTC", 181));
});

test("missing days remain absent rather than being filled with zeros", async () => {
  const result = await new GoogleAnalytics(config, mock(response([["20260101", "3"], ["20260103", "0"]]))).report("token", property, "sessions", "", range);
  assert.deepEqual(result.observations, [{ date: "2026-01-01", value: 3 }, { date: "2026-01-03", value: 0 }]);
  assert.equal(result.missingDays, 1);
});

test("sync catches up after downtime and never treats a withheld batch as history", () => {
  const now = new Date("2026-09-20T20:00:00Z");
  assert.equal(syncRange("UTC", 7, "2026-09-01", now).start, "2026-08-26");
  assert.equal(syncRange("UTC", 7, null, now).start, dailyRange("UTC", 180, now).start);
  assert.equal(syncRange("UTC", 7, "2025-01-01", now).start, dailyRange("UTC", 180, now).start);
});

test("pagination is complete and rejects duplicates or changed totals", async () => {
  let calls = 0;
  const paged: typeof fetch = async (_url, init) => {
    assert.equal(init?.redirect, "error");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.offset, String(calls));
    return Response.json(response([[calls++ ? "20260102" : "20260101", "10"]], { rowCount: 2 }));
  };
  assert.equal((await new GoogleAnalytics(config, paged).report("token", property, "sessions", "", range)).rowCount, 2);
  await assert.rejects(new GoogleAnalytics(config, mock(response([["20260101", "1"]], { rowCount: 2 }))).report("token", property, "sessions", "", range), rejects("invalid_response"));
});

test("quality restrictions propagate instead of turning into confident observations", async () => {
  const body = response([["20260101", "1"]], { metadata: { timeZone: property.timezone, subjectToThresholding: true,
    dataLossFromOtherRow: true, samplingMetadatas: [{ samplesReadCount: "1", samplingSpaceSize: "10" }], schemaRestrictionResponse: { activeMetricRestrictions: [{ metricName: "sessions" }] } } });
  assert.deepEqual((await new GoogleAnalytics(config, mock(body)).report("token", property, "sessions", "", range)).quality,
    { thresholded: true, otherRow: true, sampled: true, restricted: true });
});

test("malformed dates, counts, missing metadata and timezone changes fail closed", async () => {
  for (const body of [response([["20260230", "1"]]), response([["20260101", "NaN"]]), response([["20260101", "-1"]]),
    response([["20260101", "1"]], { metadata: { timeZone: "UTC" } }), response([], { metadata: null }),
    response([], { rowCount: 2 }), response([], { rowCount: 181 }), response([], { metricHeaders: [{ name: "revenue" }] })]) {
    await assert.rejects(new GoogleAnalytics(config, mock(body)).report("token", property, "sessions", "", range), rejects("invalid_response"));
  }
});

test("only reviewed additive metrics and optional event filters are allowed", () => {
  assert.deepEqual(metricSelection("eventCount", "purchase"), { metric: "eventCount", event: "purchase" });
  assert.throws(() => metricSelection("activeUsers"));
  assert.throws(() => metricSelection("sessions", "purchase"));
  assert.throws(() => metricSelection("eventCount", "<script>"));
});

test("Google errors are redacted and revocation is explicit", async () => {
  const google = new GoogleAnalytics(config, mock({ error: "invalid_grant", error_description: "private token and account" }, 400));
  await assert.rejects(google.token({ refreshToken: "private" }), (error: unknown) => {
    assert.equal(String(error), "Error: reauthorize"); return true;
  });
  const refreshed = await new GoogleAnalytics(config, mock({ access_token: "new-access", scope: GA4_SCOPE })).token({ refreshToken: "old-refresh" });
  assert.equal(refreshed.refreshToken, null);
  await assert.rejects(new GoogleAnalytics(config, mock({ access_token: "access", scope: "openid" })).token({ code: "code" }), rejects("permission"));
});

test("property listing follows pagination and rejects repeated tokens", async () => {
  let calls = 0;
  const google = new GoogleAnalytics(config, async (url) => {
    assert.ok(String(url).startsWith("https://analyticsadmin.googleapis.com/"));
    return Response.json({ accountSummaries: [{ propertySummaries: [{ property: `properties/${++calls}`, displayName: `Property ${calls}` }] }], ...(calls === 1 ? { nextPageToken: "next" } : {}) });
  });
  assert.deepEqual(await google.properties("access"), [{ id: "1", name: "Property 1" }, { id: "2", name: "Property 2" }]);
  await assert.rejects(new GoogleAnalytics(config, mock({ nextPageToken: "same" })).properties("access"), rejects("invalid_response"));
});

test("oversized provider responses are bounded", async () => {
  const google = new GoogleAnalytics(config, async () => new Response("x".repeat(1_048_577)));
  await assert.rejects(google.properties("access"), rejects("invalid_response"));
});

test("provider retries are bounded by both attempts and the operation deadline", async () => {
  let calls = 0;
  const limited: typeof fetch = async () => { calls++; return Response.json({ error: "quota" }, { status: 429 }); };
  await assert.rejects(new GoogleAnalytics(config, limited).properties("access"), rejects("quota"));
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(new GoogleAnalytics(config, limited, Date.now() - 1).properties("access"), rejects("unavailable"));
  assert.equal(calls, 0);
});

test("successful empty revocation responses are accepted without retrying token operations", async () => {
  await new GoogleAnalytics(config, async () => new Response(null, { status: 200 })).revoke("refresh");
  let calls = 0;
  const unavailable: typeof fetch = async () => { calls++; return Response.json({}, { status: 503 }); };
  await assert.rejects(new GoogleAnalytics(config, unavailable).token({ refreshToken: "refresh" }), rejects("unavailable"));
  assert.equal(calls, 1);
});

test("connector config requires a private worker role and a fixed secure callback", () => {
  const claims = Buffer.from(JSON.stringify({ role: "causent_ga4_worker", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const env = { CAUSENT_GA4_ENABLED: "1", GA4_CLIENT_ID: "id", GA4_CLIENT_SECRET: "secret", GA4_REDIRECT_URI: config.redirectUri,
    GA4_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), GA4_WORKER_JWT: `header.${claims}.signature` };
  assert.equal(ga4Config(env).overlapDays, 7);
  for (const delta of [{ CAUSENT_LOCAL_DEMO: "1" }, { CAUSENT_GA4_ENABLED: "0" }, { GA4_REDIRECT_URI: "https://example.test/api/ga4/callback?next=evil" },
    { GA4_REDIRECT_URI: "http://example.test/api/ga4/callback" }, { GA4_ENCRYPTION_KEY: "wrong" }, { GA4_WORKER_JWT: "bad" }]) {
    assert.throws(() => ga4Config({ ...env, ...delta }));
  }
});
