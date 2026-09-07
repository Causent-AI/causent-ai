import { test } from "node:test";
import assert from "node:assert/strict";
import { collectKeyset } from "./keyset.ts";

for (const count of [0, 1, 499, 500, 501, 1000, 1501]) {
  test(`keyset reads ${count} rows through a smaller API cap and proves completion`, async () => {
    const data = Array.from({ length: count }, (_, i) => ({ id: String(i).padStart(5, "0") }));
    let emptyPage = false;
    const result = await collectKeyset(async (after, size) => {
      const page = data.filter((row) => after === null || row.id > after).slice(0, Math.min(137, size));
      emptyPage ||= page.length === 0;
      return { data: page, error: null };
    }, (row) => row.id, 1501);
    assert.deepEqual(result.rows, data);
    assert.deepEqual(result.completeness, { complete: true, rowCount: count, limit: 1501, consistency: "keyset" });
    assert.ok(emptyPage);
  });
}

test("a full exact-limit page needs an empty next page; one extra row fails visibly", async () => {
  const all = [{ id: "1" }, { id: "2" }, { id: "3" }];
  await assert.rejects(collectKeyset(async (after, size) => ({
    data: all.filter((row) => after === null || row.id > after).slice(0, size), error: null,
  }), (row) => row.id, 2), /Read limit exceeded/);
});

test("duplicate and out-of-order cursors are rejected, including within one page", async () => {
  for (const ids of [["1", "1"], ["2", "1"]]) {
    await assert.rejects(collectKeyset(async () => ({ data: ids, error: null }), (id) => id), /cursor did not advance/);
  }
});

test("a later page failure never returns partial success", async () => {
  const error = new Error("database unavailable");
  await assert.rejects(collectKeyset(async (after) => after
    ? { data: null, error } : { data: ["1"], error: null }, (id) => id), error);
});
