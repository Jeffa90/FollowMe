import { z } from "zod";
export const NODE_TYPES = ["task", "decision", "handoff", "control", "exception"] as const;
export const nodeSchema = z.object({
  id: z.string().min(1).max(30), type: z.enum(NODE_TYPES), title: z.string().min(1).max(200), role: z.string().max(100).default(""),
  guideDocumentId: z.string().max(40).optional(), controls: z.array(z.string().max(300)).max(10).default([]),
  next: z.array(z.object({ to: z.string().max(30), label: z.string().max(100).default("") })).max(6).default([]),
});
export const mapContentSchema = z.object({
  triggers: z.array(z.string().max(300)).max(10).default([]), inputs: z.array(z.string().max(300)).max(20).default([]), outputs: z.array(z.string().max(300)).max(20).default([]),
  nodes: z.array(nodeSchema).max(100).default([]), policies: z.array(z.string().max(300)).max(20).default([]), forms: z.array(z.string().max(300)).max(20).default([]),
});
export type MapContent = z.infer<typeof mapContentSchema>;

/** Structural checks used before publication. */
export function validateMap(c: MapContent): string[] {
  const p: string[] = [];
  if (!c.triggers.length) p.push("Define at least one trigger.");
  if (!c.outputs.length) p.push("Define at least one output.");
  if (!c.nodes.length) p.push("Add at least one step.");
  const ids = new Set(c.nodes.map((n) => n.id));
  if (ids.size !== c.nodes.length) p.push("Step ids must be unique.");
  for (const n of c.nodes) {
    for (const x of n.next) if (!ids.has(x.to)) p.push(`Step "${n.title}" points to unknown step "${x.to}".`);
    if (n.type === "decision" && n.next.length < 2) p.push(`Decision "${n.title}" needs at least two outgoing paths.`);
    if (n.type === "handoff" && !n.role) p.push(`Handoff "${n.title}" should name the receiving role.`);
  }
  if (c.nodes.length) {
    const seen = new Set<string>([c.nodes[0].id]); const q = [c.nodes[0].id];
    while (q.length) { const id = q.pop()!; const cur = c.nodes.find((n) => n.id === id); for (const x of cur?.next ?? []) if (!seen.has(x.to) && ids.has(x.to)) { seen.add(x.to); q.push(x.to); } }
    for (const n of c.nodes) if (!seen.has(n.id)) p.push(`Step "${n.title}" is not reachable from the first step.`);
  }
  return p;
}
