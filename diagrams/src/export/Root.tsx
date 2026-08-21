// Remotion root (spec 5.4): one component tree, two outputs - Studio/Player
// give the scrubbable interactive artifact; `remotion render` exports the
// video of the SAME composition, so both are provably the same run.
import React from "react";
import { Composition, Still, staticFile, getStaticFiles } from "remotion";
import { Sequence, totalDurationSec } from "../renderers/sequence/Sequence";
import { Structural } from "../renderers/structural/Structural";
import { callTrace, structuralFixture } from "../fixtures/call-fixture";
import type { NarrationManifest } from "../schema";

const FPS = 30;

async function loadManifest(): Promise<NarrationManifest | undefined> {
  const files = getStaticFiles();
  if (!files.some((f) => f.name === "narration/manifest.json")) return undefined;
  const res = await fetch(staticFile("narration/manifest.json"));
  return (await res.json()) as NarrationManifest;
}

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
          const manifest = await loadManifest();
          return {
            durationInFrames: Math.ceil(totalDurationSec(callTrace, manifest) * FPS),
            props: { trace: callTrace, manifest },
          };
        }}
      />
      <Still id="StructuralMap" component={Structural as never} width={1920} height={1080} defaultProps={{ graph: structuralFixture }} />
    </>
  );
};
