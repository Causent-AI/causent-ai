type DatedNode = { id: string; workspaceId: string; date: string };

export function layoutDecisionNetwork(nodes: DatedNode[]) {
  const width = Math.max(1000, nodes.length * 155);
  const dates = nodes.map((node) => Date.parse(node.date));
  const start = Math.min(...dates);
  const end = Math.max(...dates);
  const coordinates = new Map<string, { x: number; y: number }>();
  const groups: Array<{ workspaceId: string; y: number }> = [];
  let top = 130;

  for (const workspaceId of new Set(nodes.map((node) => node.workspaceId))) {
    const laneEnds: number[] = [];
    groups.push({ workspaceId, y: top + 15 });
    const ordered = nodes
      .filter((node) => node.workspaceId === workspaceId)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    for (const node of ordered) {
      const x = 260 + (end > start ? (Date.parse(node.date) - start) / (end - start) : 0) * (width - 380);
      let lane = laneEnds.findIndex((lastX) => x - lastX >= 240);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = x;
      coordinates.set(node.id, { x, y: top + lane * 104 });
    }
    top += Math.max(1, laneEnds.length) * 104 + 80;
  }
  return { width, height: Math.max(420, top + 70), coordinates, groups };
}
