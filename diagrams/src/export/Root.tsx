// Remotion root (spec 5.4): one component tree, two outputs - Studio/Player
// give the scrubbable interactive artifact; `remotion render` exports the
// video of the SAME composition, so both are provably the same run.
//
// Real data over fixtures: `tsx src/export/prepare.ts <respec/spec.json>`
// writes public/data/{structural,trace}.json, and every composition prefers
// those when present. The fixtures stay as the fallback so the renderers are
// still runnable (and testable) with no project attached.
import React from "react";
import { Composition, Still, staticFile, getStaticFiles } from "remotion";
import { Sequence, totalDurationSec } from "../renderers/sequence/Sequence";
import { Structural } from "../renderers/structural/Structural";
import { Deployment } from "../renderers/deployment/Deployment";
import { StateMachine } from "../renderers/state-machine/StateMachine";
import { Activity } from "../renderers/activity/Activity";
import { callTrace, structuralFixture, deploymentFixture, stateMachineFixture, activityFixture } from "../fixtures/call-fixture";
import type { NarrationManifest, StaticGraph, Trace } from "../schema";

const FPS = 30;

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
      <Still
        id="StructuralMap"
        component={Structural as never}
        width={1920}
        height={1080}
        defaultProps={{ graph: structuralFixture }}
        calculateMetadata={async () => ({ props: { graph: (await loadGraph()) ?? structuralFixture } })}
      />
      <Still id="DeploymentMap" component={Deployment as never} width={1920} height={1080} defaultProps={{ graph: deploymentFixture }} />
      <Still id="StateMachineAggregate" component={StateMachine as never} width={1920} height={1080} defaultProps={{ graph: stateMachineFixture }} />
      <Still id="ActivityFlow" component={Activity as never} width={1920} height={1080} defaultProps={{ graph: activityFixture }} />
    </>
  );
};
