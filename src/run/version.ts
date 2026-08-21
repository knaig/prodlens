// Versioned run outputs: every command invocation that produces artifacts
// lands under data/projects/<app>/runs/v0.<n>/<type>/<file>, so re-running a
// command never overwrites a previous run's output. The version increments per
// run (v0.1, v0.2, ...) by scanning the existing run folders; a run folder
// groups the artifact types it produced (visual/, reports/, ...) as
// subfolders. Mirrors the GraphVersion versioning in src/graph/graph-store.ts,
// but for whole-run output rather than a single graph artifact.
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Next unused run version for a project root, e.g. "v0.1" then "v0.2".
 *  Scans <root>/runs/ for existing v0.<n> folders and takes the highest + 1. */
export function nextRunVersion(projectRoot: string): string {
  const runsDir = join(projectRoot, "runs");
  let maxMinor = 0;
  if (existsSync(runsDir)) {
    for (const entry of readdirSync(runsDir)) {
      const m = /^v0\.(\d+)$/.exec(entry);
      if (m) maxMinor = Math.max(maxMinor, Number(m[1]));
    }
  }
  return `v0.${maxMinor + 1}`;
}

/** Create (and return) the next versioned run folder for a project root. */
export function createRunDir(projectRoot: string): string {
  const version = nextRunVersion(projectRoot);
  const dir = join(projectRoot, "runs", version);
  mkdirSync(dir, { recursive: true });
  return dir;
}
