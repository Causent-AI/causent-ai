import assert from "node:assert/strict";
import { test } from "node:test";

import { decisionReportActionDestination } from "./action-navigation.ts";

test("deep-links a resolved canonical action in the query and fragment", () => {
  assert.equal(
    decisionReportActionDestination({
      actionId: "action/with space",
      decisionId: "decision-id",
    }),
    "/actions?selected=action%2Fwith%20space#action%2Fwith%20space",
  );
});

test("falls back to the decision only when no canonical action binding exists", () => {
  assert.equal(
    decisionReportActionDestination({
      actionId: null,
      decisionId: "decision/with space",
    }),
    "/actions?selected=decision%2Fwith%20space",
  );
});
