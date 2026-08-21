// elkjs layout adapter (spec 5.4): hierarchical layout for every node/edge
// diagram. Boxes are sized from MEASURED text (canvas measureText in the
// Chromium runtime) - this is what kills the truncation bug. Never hand-place
// coordinates.
import ELK from "elkjs/lib/elk.bundled.js";
import type { StaticGraph } from "../schema";

export interface PositionedNode {
  id: string;
  label: string;
  sublabel?: string;
  kind?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parent?: string;
}
export interface PositionedEdge {
  from: string;
  to: string;
  label?: string;
  /** Polyline points from elk routing. */
  points: Array<{ x: number; y: number }>;
}
export interface Layout {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  width: number;
  height: number;
}

const FONT_LABEL = "600 15px Inter, system-ui, sans-serif";
const FONT_SUB = "400 11.5px Inter, system-ui, sans-serif";

let ctx: CanvasRenderingContext2D | null = null;
function measure(text: string, font: string): number {
  if (typeof document !== "undefined") {
    if (!ctx) ctx = document.createElement("canvas").getContext("2d");
    if (ctx) {
      ctx.font = font;
      return ctx.measureText(text).width;
    }
  }
  // Node-side fallback (pregen scripts): Inter averages ~0.56em per char.
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 14);
  return text.length * size * 0.56;
}

export async function layoutGraph(graph: StaticGraph, opts: { direction?: "RIGHT" | "DOWN" } = {}): Promise<Layout> {
  const elk = new ELK();
  const PAD_X = 28, PAD_Y = 20;
  interface ElkChild {
    id: string; width: number; height: number; children: ElkChild[];
    layoutOptions?: Record<string, string>;
  }
  const childrenOf = (parent?: string): ElkChild[] =>
    graph.nodes.filter((n) => n.parent === parent).map((n) => {
      const w = Math.max(measure(n.label, FONT_LABEL), n.sublabel ? measure(n.sublabel, FONT_SUB) : 0) + PAD_X * 2;
      const h = (n.sublabel ? 58 : 44) + PAD_Y;
      return {
        id: n.id,
        width: Math.max(120, Math.ceil(w)),
        height: h,
        children: childrenOf(n.id),
        layoutOptions: childrenOf(n.id).length ? { "elk.padding": "[top=36,left=16,bottom=16,right=16]" } : undefined,
      };
    });

  const elkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": opts.direction ?? "RIGHT",
      "elk.spacing.nodeNode": "36",
      "elk.layered.spacing.nodeNodeBetweenLayers": "72",
      "elk.edgeRouting": "ORTHOGONAL",
    },
    children: childrenOf(undefined),
    edges: graph.edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  };

  const res = await elk.layout(elkGraph as never);
  const nodes: PositionedNode[] = [];
  const walk = (children: unknown[], ox: number, oy: number, parent?: string) => {
    for (const c of children ?? []) {
      const n = graph.nodes.find((g) => g.id === (c as unknown as { id: string }).id)!;
      const cc = c as unknown as { id: string; x: number; y: number; width: number; height: number; children?: never[] };
      nodes.push({ id: cc.id, label: n.label, sublabel: n.sublabel, kind: n.kind, parent, x: ox + cc.x, y: oy + cc.y, width: cc.width, height: cc.height });
      if (cc.children?.length) walk(cc.children, ox + cc.x, oy + cc.y, cc.id);
    }
  };
  walk((res as never as { children: never[] }).children, 0, 0);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: PositionedEdge[] = graph.edges.map((e, i) => {
    const elkEdge = (res as never as { edges?: Array<{ id: string; sections?: Array<{ startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; bendPoints?: Array<{ x: number; y: number }> }> }> }).edges?.find((x) => x.id === `e${i}`);
    const s = elkEdge?.sections?.[0];
    const points = s
      ? [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]
      : (() => {
          const a = byId.get(e.from)!, b = byId.get(e.to)!;
          return [
            { x: a.x + a.width, y: a.y + a.height / 2 },
            { x: b.x, y: b.y + b.height / 2 },
          ];
        })();
    return { from: e.from, to: e.to, label: e.label, points };
  });

  const width = Math.max(...nodes.map((n) => n.x + n.width), 400) + 40;
  const height = Math.max(...nodes.map((n) => n.y + n.height), 300) + 40;
  return { nodes, edges, width, height };
}
