import assert from "node:assert/strict";
import test from "node:test";

import { reportAssetPreviewUrl } from "./assets.ts";

test("private report previews are content-versioned without exposing a Storage path", () => {
  const assetId = "11111111-1111-4111-8111-111111111111";
  const url = reportAssetPreviewUrl(assetId, "sha256:value/with spaces");

  assert.equal(
    url,
    `/api/decision-report-assets/${assetId}?v=sha256%3Avalue%2Fwith%20spaces`,
  );
  assert.equal(url.includes("decision-report-assets/"), true);
  assert.equal(url.includes("workspaces/"), false);
});
