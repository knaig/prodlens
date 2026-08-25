// Remotion root (spec 5.4): one component tree, two outputs - Studio/Player
// give the scrubbable interactive artifact; `remotion render` exports the
// video of the SAME composition, so both are provably the same run.
//
// Real data over fixtures: `tsx src/export/prepare.ts <respec/spec.json>`
// writes public/data/{structural,trace}.json, and every composition prefers
// those when present. The fixtures stay as the fallback so the renderers are
// still runnable (and testable) with no project attached.
import React from "react";
import { Composition, Still, staticFile, getStaticFiles, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { Sequence, totalDurationSec } from "../renderers/sequence/Sequence";
import { Structural } from "../renderers/structural/Structural";
import { Deployment } from "../renderers/deployment/Deployment";
import { StateMachine } from "../renderers/state-machine/StateMachine";
import { Activity } from "../renderers/activity/Activity";
import { callTrace, structuralFixture, deploymentFixture, stateMachineFixture, activityFixture } from "../fixtures/call-fixture";
import type { NarrationManifest, StateMachineGraph, StaticGraph, Trace } from "../schema";

const FPS = 30;

/** The system map built up over the shot, rather than arriving whole. Held
 *  briefly complete at the end so the last components are not cut off by the
 *  segment boundary. */
const StructuralReveal: React.FC<{ graph: StaticGraph }> = ({ graph }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const reveal = interpolate(frame, [0, Math.max(1, durationInFrames * 0.75)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <Structural graph={graph} reveal={reveal} />;
};

function hasStatic(name: string): boolean {
  return getStaticFiles().some((f) => f.name === name);
}

async function loadJson<T>(name: string): Promise<T | undefined> {
  if (!hasStatic(name)) return undefined;
  try {
    const res = await fetch(staticFile(name));
    return (await res.json()) as T;
  } catch {
    return undefined; // a malformed drop-in must not break the render
  }
}

const loadManifest = () => loadJson<NarrationManifest>("narration/manifest.json");
const loadGraph = () => loadJson<StaticGraph>("data/structural.json");
const loadTrace = () => loadJson<Trace>("data/trace.json");
const loadDeployment = () => loadJson<StaticGraph>("data/deployment.json");
const loadActivity = () => loadJson<StaticGraph>("data/activity.json");
const loadStateMachine = () => loadJson<StateMachineGraph>("data/state-machine.json");

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="SequenceCall"
        component={Sequence as never}
        fps={FPS}
        width={1920}
        height={1080}
        durationInFrames={30 * FPS}
        defaultProps={{ trace: callTrace, manifest: undefined }}
        calculateMetadata={async () => {
          const [manifest, real] = await Promise.all([loadManifest(), loadTrace()]);
          const trace = real ?? callTrace;
          return {
            durationInFrames: Math.ceil(totalDurationSec(trace, manifest) * FPS),
            props: { trace, manifest },
          };
        }}
      />
      <Composition
        id="StructuralReveal"
        component={StructuralReveal as never}
        fps={FPS}
        width={1920}
        height={1080}
        durationInFrames={8 * FPS}
        defaultProps={{ graph: structuralFixture, durationSec: 8 }}
        calculateMetadata={async ({ props }) => {
          const p = props as { durationSec?: number };
          return {
            durationInFrames: Math.max(FPS, Math.round((p.durationSec ?? 8) * FPS)),
            props: { graph: (await loadGraph()) ?? structuralFixture },
          };
        }}
      />
      <Still
        id="StructuralMap"
        component={Structural as never}
        width={1920}
        height={1080}
        defaultProps={{ graph: structuralFixture }}
        calculateMetadata={async () => ({ props: { graph: (await loadGraph()) ?? structuralFixture } })}
      />
      <Still
        id="DeploymentMap"
        component={Deployment as never}
        width={1920}
        height={1080}
        defaultProps={{ graph: deploymentFixture }}
        calculateMetadata={async () => ({ props: { graph: (await loadDeployment()) ?? deploymentFixture } })}
      />
      <Still
        id="StateMachineAggregate"
        component={StateMachine as never}
        width={1920}
        height={1080}
        defaultProps={{ graph: stateMachineFixture }}
        calculateMetadata={async () => ({ props: { graph: (await loadStateMachine()) ?? stateMachineFixture } })}
      />
      <Still
        id="ActivityFlow"
        component={Activity as never}
        width={1920}
        height={1080}
        defaultProps={{ graph: activityFixture }}
        calculateMetadata={async () => ({ props: { graph: (await loadActivity()) ?? activityFixture } })}
      />
    </>
  );
};
