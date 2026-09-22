import assert from "node:assert/strict";
import test from "node:test";
import { mergeAttributes } from "@tiptap/core";

test("untrusted editor attributes cannot inject inherited executable attributes", () => {
  const input = JSON.parse('{"__proto__":{"onclick":"untrusted()","onerror":"untrusted()"},"class":"report"}');
  const attributes = mergeAttributes({ class: "paragraph" }, input);
  assert.equal(Object.getPrototypeOf(attributes), Object.prototype);
  assert.equal(attributes.onclick, undefined);
  assert.equal(attributes.onerror, undefined);
  assert.equal(attributes.class, "paragraph report");
  assert.ok(!Object.keys(attributes).includes("onclick"));
});
