// Structural (component) diagram. elk layout, measured-text box sizing.
//
// Static by default (spec 5.4: no camera pans, no glow timers). `reveal`
// optionally builds the map up as it is described - the professor effect: the
// system appears piece by piece under the narration instead of arriving whole
// and sitting still. Undefined means everything is visible, which is what the
// still export wants.
import React, { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";
import { layoutGraph, arcMidpoint, type Layout } from "../../layout/elk-adapter";
import type { StaticGraph } from "../../schema";
import { kindIcon, KIND_COLOR } from "../icons";

export const Structural: React.FC<{ graph: StaticGraph; reveal?: number }> = ({ graph, reveal }) => {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [handle] = useState(() => delayRender("elk layout"));
  useEffect(() => {
    void layoutGraph(graph).then((l) => { setLayout(l); continueRender(handle); });
  }, [graph, handle]);
  if (!layout) return null;
  const scale = Math.min(1440 / layout.width, 760 / layout.height, 1.4);
  // Containers first so a boundary never pops in after what it holds.
  const order = new Map(
    [...layout.nodes]
      .sort((a, b) => Number(layout.nodes.some((c) => c.parent === b.id)) - Number(layout.nodes.some((c) => c.parent === a.id)))
      .map((n, i) => [n.id, i] as const),
  );
  const shown = reveal === undefined ? layout.nodes.length : Math.round(reveal * layout.nodes.length);
  const nodeIn = (id: string) => (order.get(id) ?? 0) < shown;
  const opacityOf = (id: string) => (nodeIn(id) ? 1 : 0.06);
  return (
    <div style={{ width: "100%", height: "100%", background: "#0b0d10", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ color: "#e9edf4", fontSize: 26, fontWeight: 700, padding: "28px 0 0 48px" }}>{graph.title}</div>
      <svg width={1920} height={940} viewBox={`0 0 ${1920 / scale} ${940 / scale}`} style={{ display: "block", margin: "10px 0 0 48px" }}>
        {layout.edges.map((e, i) => (
          <polyline key={i} points={e.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#3b4250" strokeWidth={1.6} markerEnd="url(#arr)"
            opacity={nodeIn(e.from) && nodeIn(e.to) ? 1 : 0} style={{ transition: "opacity 240ms" }} />
        ))}
        <defs>
          <marker id="arr" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L9,4 L0,8 z" fill="#3b4250" /></marker>
        </defs>
        {layout.nodes.map((n) => {
          const isContainer = layout.nodes.some((c) => c.parent === n.id);
          const color = KIND_COLOR[n.kind ?? "other"] ?? KIND_COLOR.other;
          const Icon = kindIcon(n.kind);
          const textX = n.x + (isContainer ? 14 : 14 + 22);
          return (
            <g key={n.id} opacity={opacityOf(n.id)} style={{ transition: "opacity 320ms" }}>
              <rect x={n.x} y={n.y} width={n.width} height={n.height} rx={10}
                fill={isContainer ? "transparent" : "#141925"}
                stroke={color} strokeWidth={1.6}
                strokeDasharray={isContainer ? "6 5" : undefined} />
              {!isContainer && (
                <g transform={`translate(${n.x + 14}, ${n.y + 14})`}><Icon color={color} size={16} /></g>
              )}
              <text x={textX} y={n.y + 24} fill="#e9edf4" fontSize={15} fontWeight={600}>{n.label}</text>
              {n.sublabel && <text x={textX} y={n.y + 43} fill="#8b95a8" fontSize={11.5}>{n.sublabel}</text>}
            </g>
          );
        })}
        {/* Edge labels drawn last, on top of node boxes and lines - a
         * label's arc-midpoint can sit right at a box edge in tightly
         * packed layouts, and a stroke-only halo leaves gaps inside
         * letters that a line running through the label pokes through -
         * back it with a solid chip. */}
        {layout.edges.map((e, i) => {
          if (!e.label) return null;
          const mid = arcMidpoint(e.points);
          const w = e.label.length * 6.2 + 10;
          return (
            <g key={i}>
              <rect x={mid.x - w / 2} y={mid.y - 17} width={w} height={15} rx={3} fill="#0b0d10" />
              <text x={mid.x} y={mid.y - 6} fill="#8b95a8" fontSize={11} textAnchor="middle">{e.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
