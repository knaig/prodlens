// Spec: v2 §4, §13.8 (artifact registry) - see spec/traceability.md
// Studio persistence: per-project script.md + demo-spec.json + narration.json +
// gaps.json + rendered videos under data/projects/<id>/studio/.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, type Project } from "../web/registry.js";
import type { DemoSpec2, Gap, NarrationDoc } from "./types.js";

export function studioDir(p: Project): string {
  const d = join(projectRoot(p.id), "studio");
  mkdirSync(d, { recursive: true });
  return d;
}

export interface StudioState {
  script: string;
  spec?: DemoSpec2;
  narration?: NarrationDoc;
  gaps: Gap[];
  videos: Array<{ rel: string; size: number; mtime: string }>;
}

function readJsonSafe<T>(p: string): T | undefined {
  try { return JSON.parse(readFileSync(p, "utf-8")) as T; } catch { return undefined; }
}

export function getStudio(p: Project): StudioState {
  const d = studioDir(p);
  const videosDir = join(d, "videos");
  const videos = existsSync(videosDir)
    ? readdirSync(videosDir).filter((f) => f.endsWith(".mp4")).map((f) => {
        const st = statSync(join(videosDir, f));
        return { rel: `studio/videos/${f}`, size: st.size, mtime: st.mtime.toISOString() };
      }).sort((a, b) => b.mtime.localeCompare(a.mtime))
    : [];
  return {
    script: existsSync(join(d, "script.md")) ? readFileSync(join(d, "script.md"), "utf-8") : "",
    spec: readJsonSafe<DemoSpec2>(join(d, "demo-spec.json")),
    narration: readJsonSafe<NarrationDoc>(join(d, "narration.json")),
    gaps: readJsonSafe<Gap[]>(join(d, "gaps.json")) ?? [],
    videos,
  };
}

export function saveScript(p: Project, text: string): void {
  writeFileSync(join(studioDir(p), "script.md"), text);
}

export function saveCompiled(p: Project, spec: DemoSpec2, narration: NarrationDoc, gaps: Gap[]): void {
  const d = studioDir(p);
  writeFileSync(join(d, "demo-spec.json"), JSON.stringify(spec, null, 2));
  writeFileSync(join(d, "narration.json"), JSON.stringify(narration, null, 2));
  writeFileSync(join(d, "gaps.json"), JSON.stringify(gaps, null, 2));
}

export function saveNarration(p: Project, narration: NarrationDoc): void {
  writeFileSync(join(studioDir(p), "narration.json"), JSON.stringify(narration, null, 2));
}

export function saveSpec(p: Project, spec: DemoSpec2): void {
  writeFileSync(join(studioDir(p), "demo-spec.json"), JSON.stringify(spec, null, 2));
}

// ---- Artifact registry (spec 13.8): versioned + described, team-shared ----
export interface ArtifactEntry {
  id: string;
  name: string;      // logical name, e.g. "operator-workflow-video"
  version: number;   // monotonic per name
  title: string;
  description: string;
  kind: "video" | "respec" | "report" | "storyboard";
  rel: string;       // project-relative path
  inputsHash?: string;
  createdAt: string;
  createdBy?: string;
}

function registryPath(p: Project): string {
  return join(projectRoot(p.id), "artifact-registry.json");
}

export function listRegistry(p: Project): ArtifactEntry[] {
  try { return JSON.parse(readFileSync(registryPath(p), "utf-8")); } catch { return []; }
}

/** Register an artifact; version auto-increments per logical name. Returns a
 *  duplicate warning when an entry with the same inputsHash already exists. */
export function registerArtifact(p: Project, e: Omit<ArtifactEntry, "id" | "version" | "createdAt">): { entry: ArtifactEntry; duplicateOf?: ArtifactEntry } {
  const all = listRegistry(p);
  const duplicateOf = e.inputsHash ? all.find((x) => x.inputsHash === e.inputsHash && x.kind === e.kind) : undefined;
  const version = all.filter((x) => x.name === e.name).reduce((m, x) => Math.max(m, x.version), 0) + 1;
  const entry: ArtifactEntry = { ...e, id: `${e.name}-v${version}`, version, createdAt: new Date().toISOString() };
  all.unshift(entry);
  writeFileSync(registryPath(p), JSON.stringify(all, null, 2));
  return { entry, duplicateOf };
}

export function specHash(x: unknown): string {
  const s = JSON.stringify(x);
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}
