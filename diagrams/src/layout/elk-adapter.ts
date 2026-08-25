// elkjs layout adapter (spec 5.4): hierarchical layout for every node/edge
// diagram. Boxes are sized from MEASURED text (canvas measureText in the
// Chromium runtime) - this is what kills the truncation bug. Never hand-place
// coordinates.
import ELK from "elkjs/lib/elk.bundled.js";
import type { StaticEdge, StaticGraph } from "../schema";

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
  kind?: StaticEdge["kind"];
  /** Polyline points from elk routing. */
  points: Array<{ x: number; y: number }>;
}
/** Point at the midpoint of the polyline's arc length - sits on the actual
 * routed path (which bends under ORTHOGONAL routing), unlike averaging the
 * two endpoints which can land off the line or inside an unrelated box. */
export function arcMidpoint(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  const segLens = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  const total = segLens.reduce((a, b) => a + b, 0);
  let remaining = total / 2;
  for (let i = 0; i < segLens.length; i++) {
    if (remaining <= segLens[i]) {
      const t = segLens[i] === 0 ? 0 : remaining / segLens[i];
      const a = points[i], b = points[i + 1];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= segLens[i];
  }
  return points[points.length - 1];
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

/** Leaf boxes reserve this much left padding for a kind icon (Structural.tsx
 * draws it at x+14); container boxes show no icon so skip the reserve. */
export const ICON_RESERVE = 24;

export async function layoutGraph(
  graph: StaticGraph,
  /** `wrap` folds a long single-file chain into several rows instead of one
   *  very tall column. Without it a 12-stage pipeline lays out taller than the
   *  canvas, the renderer scales the whole thing down to fit, and the labels
   *  become unreadable - the diagram is technically correct and useless. */
  opts: { direction?: "RIGHT" | "DOWN"; wrap?: boolean } = {},
): Promise<Layout> {
  const elk = new ELK();
  const PAD_X = 28, PAD_Y = 20;
  interface ElkChild {
    id: string; width: number; height: number; children: ElkChild[];
    layoutOptions?: Record<string, string>;
  }
  const childrenOf = (parent?: string): ElkChild[] =>
    graph.nodes.filter((n) => n.parent === parent).map((n) => {
      const isLeaf = childrenOf(n.id).length === 0;
      const w = Math.max(measure(n.label, FONT_LABEL), n.sublabel ? measure(n.sublabel, FONT_SUB) : 0) + PAD_X * 2 + (isLeaf ? ICON_RESERVE : 0);
      const h = (n.sublabel ? 58 : 44) + PAD_Y;
      return {
        id: n.id,
        width: Math.max(120, Math.ceil(w)),
        height: h,
        children: childrenOf(n.id),
        layoutOptions: isLeaf ? undefined : { "elk.padding": "[top=36,left=16,bottom=16,right=16]" },
      };
    });

  const elkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": opts.direction ?? "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": "36",
      "elk.layered.spacing.nodeNodeBetweenLayers": "72",
      "elk.edgeRouting": "ORTHOGONAL",
      ...(opts.wrap
        ? {
            "elk.layered.wrapping.strategy": "MULTI_EDGE",
            // Roughly the canvas: keeps the wrapped block inside 1920x940.
            "elk.aspectRatio": "2.0",
          }
        : {}),
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
    return { from: e.from, to: e.to, label: e.label, kind: e.kind, points };
  });

  const width = Math.max(...nodes.map((n) => n.x + n.width), 400) + 40;
  const height = Math.max(...nodes.map((n) => n.y + n.height), 300) + 40;
  return { nodes, edges, width, height };
}
