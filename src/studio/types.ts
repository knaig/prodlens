// Demo studio data model (spec v2 §4): script -> scenes -> choreography, with
// narration, audiences, and story frames as first-class artifacts.

export type SceneType = "card" | "login" | "screen" | "call" | "diagram" | "artifact";

export interface NarrationLine {
  id: string;
  sceneId: string;
  text: string;
  /** Language variants keyed by BCP-47-ish code; `text` is the default language. */
  variants?: Record<string, string>;
  /** Optional cast voice override for this line (dialogue mode). */
  voice?: string;
}

export interface NarrationDoc {
  language: string;
  register?: string;
  lines: NarrationLine[];
  glossary?: Record<string, string>;
  pronunciations?: Record<string, string>;
}

export interface VoiceSpec {
  backend?: "gemini" | "kokoro" | "say" | "auto";
  name?: string;
  /** Style prompt, e.g. "Indian English accent, warm and professional". */
  style?: string;
}

export interface Scene2 {
  id: string;
  type: SceneType;
  /** Story-frame act this scene belongs to. */
  act?: string;
  /** Narration line ids (from NarrationDoc) spoken over this scene. */
  narrationIds?: string[];
  /** Which script beat this scene satisfies (script-to-demo back-annotation). */
  beat?: string;
  // screen / login / call fields
  goto?: string;
  click?: string;
  fill?: Record<string, string>;
  scroll?: "down" | "tour" | false;
  settleMs?: number;
  optional?: boolean;
  // card fields
  title?: string;
  tagline?: string;
  // diagram fields
  tier?: "summary" | "tutorial";
  scenario?: string;
  /** "cast" = humanized components, each speaking in its own voice. */
  mode?: "narrator" | "cast";
  // call fields
  agentPath?: string;
  startClick?: string;
  endClick?: string;
  micWav?: string[];
  turnGapMs?: number;
  // artifact fields
  artifactRel?: string;
}

export interface DemoSpec2 {
  version: 2;
  title: string;
  projectId: string;
  baseUrl: string;
  audience?: string;
  frame?: string;
  language?: string;
  voice?: VoiceSpec;
  viewport?: { width: number; height: number };
  scenes: Scene2[];
}

export interface Gap {
  beat: string;
  reason: string;
  suggestion?: string;
}

export interface CompileResult {
  spec: DemoSpec2;
  narration: NarrationDoc;
  gaps: Gap[];
}

// Choreography (render contract): one timeline per scene, tracks in seconds.
export interface ChoreoEntry {
  at: number;
  [k: string]: unknown;
}
export interface SceneChoreography {
  sceneId: string;
  durationSec: number;
  tracks: {
    narration: Array<{ at: number; lineId: string; dur: number; text: string }>;
    cursor: Array<{ at: number; to: string; x?: number; y?: number }>;
    animation: Array<{ at: number; target: string; effect: string }>;
    camera: Array<{ at: number; effect: string; target?: string }>;
  };
}

// ---- Reference audiences (spec §2.4) ----
export interface AudiencePersona {
  id: string;
  who: string;
  wants: string;
  maxMinutes: number;
  register: string;
  diagramTier: "summary" | "tutorial" | "none";
  presence: "none" | "chip" | "guide";
}

export const AUDIENCES: AudiencePersona[] = [
  { id: "prospect", who: "evaluating buyer, low context", wants: "should I care?", maxMinutes: 3, register: "benefit-first, second person, no internals", diagramTier: "summary", presence: "none" },
  { id: "executive", who: "sponsor / investor", wants: "is this real and differentiated?", maxMinutes: 1.5, register: "outcome and proof, numbers on screen", diagramTier: "summary", presence: "none" },
  { id: "new-user", who: "just signed up", wants: "how do I do X?", maxMinutes: 5, register: "imperative, task language, every click named", diagramTier: "none", presence: "chip" },
  { id: "operator", who: "support / field staff in training", wants: "how do I run this daily?", maxMinutes: 8, register: "imperative, localized, repetition OK", diagramTier: "none", presence: "chip" },
  { id: "new-engineer", who: "joining the team", wants: "how does it work inside?", maxMinutes: 15, register: "precise mechanism language, code-honest", diagramTier: "tutorial", presence: "none" },
  { id: "bug-audience", who: "the dev fixing it", wants: "what exactly is broken?", maxMinutes: 5, register: "evidence-first, no polish", diagramTier: "none", presence: "none" },
];

// ---- Story frames (spec §4.6) ----
export interface StoryFrame {
  id: string;
  acts: string[];
  defaultAudience: string;
  guidance: string;
}

export const FRAMES: StoryFrame[] = [
  { id: "before-after", acts: ["before", "the product moment", "the new normal"], defaultAudience: "prospect", guidance: "Open on the painful old way, show the product doing it, close on the changed day-to-day." },
  { id: "why-now", acts: ["market shift", "what we built", "proof", "what it unlocks"], defaultAudience: "executive", guidance: "One market claim, the product in one diagram, one live proof scene, one unlock." },
  { id: "first-success", acts: ["goal", "guided steps", "visible win"], defaultAudience: "new-user", guidance: "One task end to end; celebrate the visible result." },
  { id: "day-in-the-life", acts: ["morning task", "the tool in the loop", "end of day"], defaultAudience: "operator", guidance: "Follow one operator's routine; repeat key actions." },
  { id: "life-of-a-request", acts: ["input enters", "through the system", "comes out transformed"], defaultAudience: "new-engineer", guidance: "Trace one payload across the architecture diagram, then show it live." },
  { id: "design-decision", acts: ["the constraint", "options considered", "why this shape", "the tradeoff"], defaultAudience: "new-engineer", guidance: "Ground every claim in the respec and its human annotations." },
  { id: "what-if-it-breaks", acts: ["steady state", "component fails", "degrade and recover"], defaultAudience: "new-engineer", guidance: "Show the failure path on the diagram; be honest about blast radius." },
  { id: "scale-story", acts: ["one user", "a thousand", "population scale"], defaultAudience: "executive", guidance: "What changes at each order of magnitude; numbers on screen." },
  { id: "detective", acts: ["symptom", "clues", "reproduction", "culprit"], defaultAudience: "bug-audience", guidance: "Evidence first: show the failing screen, then the trail." },
  { id: "evolution", acts: ["v1 shape", "what broke", "today's shape"], defaultAudience: "new-engineer", guidance: "History as motivation for the current architecture." },
];

export function audienceById(id?: string): AudiencePersona | undefined {
  return AUDIENCES.find((a) => a.id === id);
}
export function frameById(id?: string): StoryFrame | undefined {
  return FRAMES.find((f) => f.id === id);
}
