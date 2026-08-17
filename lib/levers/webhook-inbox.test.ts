import assert from "node:assert/strict";
import test from "node:test";

import {
  connectorHttpsOrigin,
  connectorPayloadDigest,
  connectorWebhookBodyIsBounded,
  MAX_CONNECTOR_WEBHOOK_BYTES,
} from "./webhook-inbox.ts";

test("connector origins accept only normalized HTTPS tracker origins", () => {
  assert.equal(connectorHttpsOrigin("https://Acme.atlassian.net/rest/api/3/issue/1"), "https://acme.atlassian.net");
  assert.equal(connectorHttpsOrigin("http://acme.atlassian.net/issue/1"), null);
  assert.equal(connectorHttpsOrigin("not a URL"), null);
});

test("connector delivery digests bind the exact verified body", () => {
  assert.equal(
    connectorPayloadDigest('{"event":"opened"}'),
    "0b673cee8581f0a94e4e9cb10d8fdcbb12846f839a74ca88e866b5106e7d8e66",
  );
  assert.notEqual(
    connectorPayloadDigest('{"event":"opened"}'),
    connectorPayloadDigest('{ "event": "opened" }'),
  );
});

test("connector bodies fail closed above the durable inbox bound", () => {
  assert.equal(connectorWebhookBodyIsBounded("a".repeat(MAX_CONNECTOR_WEBHOOK_BYTES)), true);
  assert.equal(connectorWebhookBodyIsBounded("a".repeat(MAX_CONNECTOR_WEBHOOK_BYTES + 1)), false);
  assert.equal(connectorWebhookBodyIsBounded("😀".repeat(MAX_CONNECTOR_WEBHOOK_BYTES / 4 + 1)), false);
});
