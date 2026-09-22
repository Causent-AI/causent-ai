import assert from "node:assert/strict";
import test from "node:test";
import { layoutDecisionNetwork } from "./decision-network-layout.ts";

test("clustered dates keep readable, non-overlapping node targets", () => {
  const nodes = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, workspaceId: "a", date: i < 6 ? "2026-08-19" : `2026-08-${i + 14}` }));
  const layout = layoutDecisionNetwork(nodes);
  for (const [i, a] of nodes.entries()) {
    const p = layout.coordinates.get(a.id)!;
    assert.ok(p.x - 112 >= 0 && p.x + 112 <= layout.width);
    assert.ok(p.y - 25 >= 0 && p.y + 65 < layout.height - 45);
    for (const b of nodes.slice(i + 1)) {
      const q = layout.coordinates.get(b.id)!;
      assert.ok(Math.abs(p.x - q.x) >= 224 || Math.abs(p.y - q.y) >= 90);
      if (a.date === b.date) assert.equal(p.x, q.x);
      else assert.ok(p.x < q.x);
    }
  }
});

test("workspace lanes stay separate and positions are deterministic", () => {
  const nodes = [
    { id: "1", workspaceId: "a", date: "2026-08-19" },
    { id: "2", workspaceId: "a", date: "2026-08-19" },
    { id: "3", workspaceId: "b", date: "2026-08-19" },
  ];
  const layout = layoutDecisionNetwork(nodes);
  assert.deepEqual(layout.coordinates, layoutDecisionNetwork([nodes[1], nodes[0], nodes[2]]).coordinates);
  assert.ok(layout.coordinates.get("3")!.y - layout.coordinates.get("2")!.y > 90);
  assert.deepEqual(layoutDecisionNetwork([]).groups, []);
});
