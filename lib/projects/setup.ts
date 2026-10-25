export type ProjectSetup = { title: string; goal: string; metrics: string[]; milestones: string[] };
export function parseProjectSetup(input: { title: unknown; goal: unknown; metrics: unknown; milestones: unknown }):
  { ok: true; value: ProjectSetup } | { ok: false; error: string } {
  if (typeof input.title !== "string" || typeof input.goal !== "string" || typeof input.metrics !== "string" || typeof input.milestones !== "string")
    return { ok: false, error: "Enter a project title and goal." };
  const title = input.title.trim(), goal = input.goal.trim();
  const metrics = input.metrics.split(/\r?\n/u).map(s => s.trim()).filter(Boolean);
  const milestones = input.milestones.split(/\r?\n/u).map(s => s.trim()).filter(Boolean);
  if (!title || title.length > 120 || !goal || goal.length > 4000)
    return { ok: false, error: "Use a title of up to 120 characters and a goal of up to 4,000 characters." };
  if (metrics.length > 30 || milestones.length > 30 || [...metrics, ...milestones].some(s => s.length > 300))
    return { ok: false, error: "Use up to 30 metrics and milestones each, with up to 300 characters per line." };
  return { ok: true, value: { title, goal, metrics, milestones } };
}
