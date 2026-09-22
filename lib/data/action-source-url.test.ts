import assert from "node:assert/strict";
import { test } from "node:test";
import { safeActionSourceUrl } from "./action-source-url.ts";
test("PR links only open safe repository-qualified GitHub entities", () => {
  assert.equal(
    safeActionSourceUrl(
      "https://github.com/Causent-AI/causent-ai/pull/37?token=untrusted#x",
    ),
    "https://github.com/Causent-AI/causent-ai/pull/37",
  );
  for (const input of [
    "javascript:alert(1)",
    "https://github.com.evil.test/x/y/pull/1",
    "https://name:password@github.com/x/y/pull/1",
    "http://github.com/x/y/pull/1",
    "https://github.com/x/y",
    null,
  ])
    assert.equal(safeActionSourceUrl(input), null);
});
