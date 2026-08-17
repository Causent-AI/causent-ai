import assert from "node:assert/strict";
import test from "node:test";

import {
  createReportAssetGetHandler,
  type ReportAssetDeliveryStore,
} from "./asset-delivery.ts";

const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const CONTENT_HASH = "a".repeat(64);
const STORAGE_PATH = `${WORKSPACE_ID}/reports/private/${ASSET_ID}.png`;
const SIGNED_URL = "https://project.supabase.co/storage/v1/object/sign/private?token=secret";

type HarnessOptions = {
  userId?: string | null;
  localDemo?: boolean;
  asset?: { objectPath: string; contentHash: string } | null;
  signedUrl?: string | null;
};

function createHarness(options: HarnessOptions = {}) {
  const lookups: Array<{ assetId: string; workspaceId: string }> = [];
  const signings: Array<{ objectPath: string; expiresIn: number }> = [];
  let storeRequests = 0;
  const store: ReportAssetDeliveryStore = {
    async findAttachedAsset(input) {
      lookups.push(input);
      return options.asset === undefined
        ? { objectPath: STORAGE_PATH, contentHash: CONTENT_HASH }
        : options.asset;
    },
    async createSignedUrl(objectPath, expiresIn) {
      signings.push({ objectPath, expiresIn });
      return options.signedUrl === undefined ? SIGNED_URL : options.signedUrl;
    },
  };
  const handler = createReportAssetGetHandler({
    isValidAssetId: (assetId) => assetId === ASSET_ID,
    getSession: async () => ({
      workspaceId: WORKSPACE_ID,
      userId: options.userId === undefined ? "authenticated-user" : options.userId,
    }),
    isLocalDemo: () => options.localDemo ?? false,
    getStore: async () => {
      storeRequests += 1;
      return store;
    },
  });
  return { handler, lookups, signings, storeRequests: () => storeRequests };
}

async function request(
  handler: ReturnType<typeof createReportAssetGetHandler>,
  query = `?v=${CONTENT_HASH}`,
) {
  return handler(
    new Request(`https://causent.test/api/decision-report-assets/${ASSET_ID}${query}`),
    { params: Promise.resolve({ assetId: ASSET_ID }) },
  );
}

async function assertOpaque(response: Response, status: 401 | 404, body: string) {
  assert.equal(response.status, status);
  assert.equal(await response.text(), body);
  assert.equal([...response.headers].join("\n").includes(STORAGE_PATH), false);
}

test("authorized delivery scopes lookup and signs the exact object for 60 seconds", async () => {
  const harness = createHarness();

  const response = await request(harness.handler);

  assert.deepEqual(harness.lookups, [{ assetId: ASSET_ID, workspaceId: WORKSPACE_ID }]);
  assert.deepEqual(harness.signings, [{ objectPath: STORAGE_PATH, expiresIn: 60 }]);
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), SIGNED_URL);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("etag"), `"${CONTENT_HASH}"`);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(await response.text(), "");
});

test("a workspace-scoped metadata miss fails closed without signing or path disclosure", async () => {
  const harness = createHarness({ asset: null });

  const response = await request(harness.handler);

  assert.deepEqual(harness.lookups, [{ assetId: ASSET_ID, workspaceId: WORKSPACE_ID }]);
  assert.deepEqual(harness.signings, []);
  await assertOpaque(response, 404, "Not found");
});

test("a forged content version fails closed before Storage signing", async () => {
  const harness = createHarness();

  const response = await request(harness.handler, "?v=forged-content-hash");

  assert.deepEqual(harness.signings, []);
  await assertOpaque(response, 404, "Not found");
});

test("a signing failure stays opaque and does not disclose the server-owned path", async () => {
  const harness = createHarness({ signedUrl: null });

  const response = await request(harness.handler);

  assert.deepEqual(harness.signings, [{ objectPath: STORAGE_PATH, expiresIn: 60 }]);
  await assertOpaque(response, 404, "Not found");
});

test("an unauthenticated production request cannot reach metadata or Storage", async () => {
  const harness = createHarness({ userId: null });

  const response = await request(harness.handler);

  assert.equal(harness.storeRequests(), 0);
  assert.deepEqual(harness.lookups, []);
  assert.deepEqual(harness.signings, []);
  await assertOpaque(response, 401, "Unauthorized");
});
