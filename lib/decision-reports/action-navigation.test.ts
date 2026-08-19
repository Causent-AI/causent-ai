import assert from "node:assert/strict";
import { test } from "node:test";

import {
  activeDecisionReportActionDestination,
  decisionReportActionDestination,
} from "./action-navigation.ts";

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

test("an active report opens its primary action through the canonical binding", () => {
  assert.equal(
    activeDecisionReportActionDestination({
      actionSourceItemId: "report-primary",
      actionBindings: [
        { actionId: "canonical-primary", actionSourceItemId: "report-primary" },
        { actionId: "canonical-support", actionSourceItemId: "report-support" },
      ],
      decisionId: "decision-id",
    }),
    "/actions?selected=canonical-primary#canonical-primary",
  );
});

test("an active report opens a supporting action through its own canonical binding", () => {
  assert.equal(
    activeDecisionReportActionDestination({
      actionSourceItemId: "report-support",
      actionBindings: [
        { actionId: "canonical-primary", actionSourceItemId: "report-primary" },
        { actionId: "canonical-support", actionSourceItemId: "report-support" },
      ],
      decisionId: "decision-id",
    }),
    "/actions?selected=canonical-support#canonical-support",
  );
});

test("an active report action fails closed when its binding is absent", () => {
  assert.equal(
    activeDecisionReportActionDestination({
      actionSourceItemId: "forged-source",
      actionBindings: [
        { actionId: "canonical-primary", actionSourceItemId: "report-primary" },
      ],
      decisionId: "decision-id",
    }),
    null,
  );
});
