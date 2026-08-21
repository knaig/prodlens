// Structural (component) diagram: STATIC by design (spec 5.4). No camera
// pans, no glow timers. elk layout, measured-text box sizing.
import React, { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";
import { layoutGraph, type Layout } from "../../layout/elk-adapter";
import type { StaticGraph } from "../../schema";

const KIND_COLOR: Record<string, string> = {
  client: "#93c5fd", frontend: "#60a5fa", backend: "#34d399", worker: "#fbbf24",
  data: "#f472b6", provider: "#a78bfa", boundary: "#f59e0b", other: "#9ca3af",
};

export const Structural: React.FC<{ graph: StaticGraph }> = ({ graph }) => {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [handle] = useState(() => delayRender("elk layout"));
  useEffect(() => {
    void layoutGraph(graph).then((l) => { setLayout(l); continueRender(handle); });
  }, [graph, handle]);
  if (!layout) return null;
  const scale = Math.min(1440 / layout.width, 760 / layout.height, 1.4);
  return (
    <div style={{ width: "100%", height: "100%", background: "#0b0d10", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ color: "#e9edf4", fontSize: 26, fontWeight: 700, padding: "28px 0 0 48px" }}>{graph.title}</div>
      <svg width={1920} height={940} viewBox={`0 0 ${1920 / scale} ${940 / scale}`} style={{ display: "block", margin: "10px 0 0 48px" }}>
        {layout.edges.map((e, i) => (
          <g key={i}>
            <polyline points={e.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#3b4250" strokeWidth={1.6} markerEnd="url(#arr)" />
            {e.label && (
              <text x={(e.points[0].x + e.points[e.points.length - 1].x) / 2} y={(e.points[0].y + e.points[e.points.length - 1].y) / 2 - 6}
                fill="#8b95a8" fontSize={11} textAnchor="middle">{e.label}</text>
            )}
          </g>
        ))}
        <defs>
          <marker id="arr" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L9,4 L0,8 z" fill="#3b4250" /></marker>
        </defs>
        {layout.nodes.map((n) => {
          const isContainer = layout.nodes.some((c) => c.parent === n.id);
          const color = KIND_COLOR[n.kind ?? "other"] ?? KIND_COLOR.other;
          return (
            <g key={n.id}>
              <rect x={n.x} y={n.y} width={n.width} height={n.height} rx={10}
                fill={isContainer ? "transparent" : "#141925"}
                stroke={color} strokeWidth={1.6}
                strokeDasharray={isContainer ? "6 5" : undefined} />
              <text x={n.x + 14} y={n.y + 24} fill="#e9edf4" fontSize={15} fontWeight={600}>{n.label}</text>
              {n.sublabel && <text x={n.x + 14} y={n.y + 43} fill="#8b95a8" fontSize={11.5}>{n.sublabel}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
};
