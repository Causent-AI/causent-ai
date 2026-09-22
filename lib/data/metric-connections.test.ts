import assert from "node:assert/strict";
import test from "node:test";

import { summarizeMetricConnections } from "./metric-connections.ts";

test("connected metrics count actual observations rather than a fixture limit", () => {
  assert.deepEqual(summarizeMetricConnections([{ series: [] }, { series: [1] }, { series: [] }]), {
    connected: 1,
    total: 3,
  });
});

test("empty workspaces have no connected metrics", () => {
  assert.deepEqual(summarizeMetricConnections([]), {
    connected: 0,
    total: 0,
  });
});
