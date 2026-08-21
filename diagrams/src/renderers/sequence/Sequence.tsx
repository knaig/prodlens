// Sequence diagram (spec 5.4): fixed lifelines, horizontal message arrows
// positioned by time-order, arrows DRAW along their path (stroke-dashoffset)
// with the arrowhead revealed only after the line completes. Judge scores as
// badges. Captions synced to narration audio; per-step timing driven by the
// pregen manifest's measured durations, never a fixed timer.
// Pure function of the current frame -> scrubbable in Player/Studio and
// identical in the exported video (one tree, two outputs).
import React from "react";
import { AbsoluteFill, Audio, Sequence as RSequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { NarrationManifest, Trace } from "../../schema";

const ROLE_COLOR: Record<string, string> = {
  persona: "#f472b6", agent: "#60a5fa", judge: "#fbbf24", guardrail: "#fb7185", component: "#34d399",
};

export interface StepWindow {
  startSec: number;
  durSec: number;
}

/** Per-step windows from the narration manifest (measured audio durations),
 *  falling back to 2.6s per step when no narration was pregenerated. */
export function stepWindows(trace: Trace, manifest?: NarrationManifest, gapSec = 0.45, leadSec = 1.0): StepWindow[] {
  let t = leadSec;
  return trace.events.map((_, i) => {
    const dur = manifest?.items.find((m) => m.index === i)?.durationSec ?? 2.6;
    const w = { startSec: t, durSec: dur };
    t += dur + gapSec;
    return w;
  });
}

export function totalDurationSec(trace: Trace, manifest?: NarrationManifest): number {
  const ws = stepWindows(trace, manifest);
  const last = ws[ws.length - 1];
  return (last ? last.startSec + last.durSec : 3) + 1.2;
}

export const Sequence: React.FC<{ trace: Trace; manifest?: NarrationManifest; audioBase?: string }> = ({ trace, manifest, audioBase = "narration" }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const sec = frame / fps;
  const ws = stepWindows(trace, manifest);

  const MARGIN = 90, HEAD_Y = 128, ROW0 = HEAD_Y + 64, ROW_H = 86;
  const colW = Math.min(300, (width - MARGIN * 2) / Math.max(trace.actors.length, 2));
  const cx = (i: number) => MARGIN + i * colW + colW / 2;
  const idx = new Map(trace.actors.map((a, i) => [a.id, i]));
  const height = ROW0 + trace.events.length * ROW_H + 80;

  const activeStep = ws.findIndex((w) => sec >= w.startSec && sec < w.startSec + w.durSec);
  const caption = activeStep >= 0 ? (trace.events[activeStep].narration ?? trace.events[activeStep].label) : "";

  return (
    <AbsoluteFill style={{ background: "#0b0d10", fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* narration audio, timed by the same windows the visuals use */}
      {manifest?.items.map((m) => {
        const w = ws[m.index];
        if (!w) return null;
        return (
          <RSequence key={`a${m.index}`} from={Math.round(w.startSec * fps)} durationInFrames={Math.ceil(m.durationSec * fps) + 3}>
            <Audio src={staticFile(`${audioBase}/${m.file}`)} />
          </RSequence>
        );
      })}
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${Math.max(height, 1080)}`}>
        <text x={MARGIN - 30} y={56} fill="#e9edf4" fontSize={28} fontWeight={700}>{trace.title}</text>
        {/* lifelines */}
        {trace.actors.map((a, i) => {
          const appear = interpolate(sec, [0.15 + i * 0.12, 0.55 + i * 0.12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const color = ROLE_COLOR[a.role] ?? "#9ca3af";
          return (
            <g key={a.id} opacity={appear}>
              <rect x={cx(i) - colW / 2 + 18} y={HEAD_Y - 44} width={colW - 36} height={48} rx={10} fill="#141925" stroke={color} strokeWidth={1.6} />
              <text x={cx(i)} y={HEAD_Y - 20} fill="#e9edf4" fontSize={15} fontWeight={600} textAnchor="middle">{a.displayName}</text>
              <text x={cx(i)} y={HEAD_Y - 4 + 12} fill="#5b6474" fontSize={10.5} textAnchor="middle">{a.role}</text>
              <line x1={cx(i)} y1={HEAD_Y + 22} x2={cx(i)} y2={height - 30} stroke="#2b3346" strokeWidth={1.2} strokeDasharray="4 6" />
            </g>
          );
        })}
        {/* messages */}
        {trace.events.map((e, i) => {
          const w = ws[i];
          const x1 = cx(idx.get(e.from) ?? 0);
          const x2 = cx(idx.get(e.to) ?? 0);
          const y = ROW0 + i * ROW_H;
          const len = Math.abs(x2 - x1);
          // Draw phase: first 45% of the step window. Arrowhead ONLY after the
          // line completes (a simultaneous reveal reads as teleporting).
          const drawEnd = w.startSec + w.durSec * 0.45;
          const draw = interpolate(sec, [w.startSec, drawEnd], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          if (sec < w.startSec) return null;
          const headVisible = draw >= 1;
          const dir = x2 >= x1 ? 1 : -1;
          const headX = x1 + (len * draw) * dir;
          const active = activeStep === i;
          const stroke = active ? "#60a5fa" : "#3b4250";
          return (
            <g key={i}>
              <line x1={x1} y1={y} x2={x1 + len * draw * dir} y2={y} stroke={stroke} strokeWidth={active ? 2.4 : 1.8} />
              {headVisible && (
                <path d={`M ${x2} ${y} l ${-10 * dir} -6 l 0 12 z`} fill={stroke} />
              )}
              {!headVisible && draw > 0.05 && <circle cx={headX} cy={y} r={4.5} fill="#34d399" />}
              <text x={(x1 + x2) / 2} y={y - 12} fill={active ? "#e9edf4" : "#8b95a8"} fontSize={13} textAnchor="middle" opacity={Math.min(1, draw * 2)}>{e.label}</text>
              {e.judgeScore !== undefined && headVisible && (
                <g>
                  <rect x={(x1 + x2) / 2 + 8 + measureLabel(e.label) / 2} y={y - 26} width={52} height={19} rx={9.5}
                    fill={e.judgeScore >= 0.7 ? "rgba(52,211,153,.15)" : "rgba(251,113,133,.15)"}
                    stroke={e.judgeScore >= 0.7 ? "#34d399" : "#fb7185"} strokeWidth={1} />
                  <text x={(x1 + x2) / 2 + 34 + measureLabel(e.label) / 2} y={y - 12.5} fontSize={11}
                    fill={e.judgeScore >= 0.7 ? "#34d399" : "#fb7185"} textAnchor="middle">{e.judgeScore.toFixed(2)}</text>
                </g>
              )}
              {/* activation bar on target after arrival */}
              {headVisible && <rect x={x2 - 5} y={y} width={10} height={interpolate(sec, [drawEnd, drawEnd + 0.5], [0, 30], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} rx={3} fill="rgba(52,211,153,.6)" />}
            </g>
          );
        })}
      </svg>
      {/* caption (accessibility + sound-off viewing) */}
      {caption && (
        <div style={{ position: "absolute", bottom: 42, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
          <div style={{ maxWidth: 1100, background: "rgba(10,13,18,.82)", border: "1px solid #2e3950", borderRadius: 12, padding: "12px 22px", color: "#e9edf4", fontSize: 21, lineHeight: 1.45, textAlign: "center" }}>
            {caption}
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

function measureLabel(s: string): number {
  return s.length * 7.2;
}
