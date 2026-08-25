// Spec: v2 §6 G3, §11 - see spec/traceability.md
// Build a ProductSurface from on-disk discovery artifacts + docs + source,
// so the LLM manifest drafter + adapters have something concrete to work from.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ComponentInfo, ProductSurface } from "./types.js";

export interface SurfaceOptions {
  /** Directory with graph.json / versions/ (discovery output). */
  dataDir?: string;
  /** Product source/repo root (for architecture + resource resolution). */
  repoRoot?: string;
  /** Docs dirs to scan (e.g. <repo>/docs, <repo>/README.md). */
  docDirs?: string[];
  /** One-line product description. */
  description?: string;
  /** Base URL if known (overrides manifest). */
  baseUrl?: string;
  /** Cap on how many key files' contents to read for adapter synthesis. */
  maxFileContents?: number;
  /** Cap on bytes per file read for adapter synthesis. */
  maxFileBytes?: number;
}

const DEFAULT_MAX_FILES = 40;
const DEFAULT_MAX_BYTES = 24_000;

/** Pick the files an LLM needs to UNDERSTAND a product for adapter synthesis:
 *  README + docs, API routes, websocket/stream handlers, configs, manifests,
 *  CLI entry points, env examples. Returns capped contents. */
function readKeyFiles(root: string, maxFiles: number, maxBytes: number): { path: string; content: string }[] {
  const want = new Set<string>();
  const addPath = (p: string) => {
    if (want.size >= maxFiles * 3) return;
    if (/\.(ts|tsx|js|jsx|py|go|rs|yaml|yml|json|md)$/.test(p) && !/\.map$/.test(p)) want.add(p);
  };
  const addDir = (rel: string) => {
    const p = join(root, rel);
    if (!existsSync(p)) return;
    const stat = statSync(p);
    if (!stat.isDirectory()) {
      addPath(p);
      return;
    }
    const walk = (d: string, depth: number) => {
      if (depth > 5 || want.size >= maxFiles * 3) return;
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const fp = join(d, ent.name);
        if (ent.isDirectory()) {
          if (/node_modules|\.git|\.next|dist|build|venv|__pycache__|coverage|vendor/.test(ent.name)) continue;
          walk(fp, depth + 1);
        } else {
          addPath(fp);
        }
      }
    };
    walk(p, 0);
  };

  for (const rel of ["README.md", "docs", "app/api", "api", "src/app/api", "routes", "src/routes", "server", "src/server", "config", "scripts", "cli", "prodlens-adapter"]) addDir(rel);
  for (const f of ["package.json", "requirements.txt", "docker-compose.yml", "env.example", ".env.example", "config.example.yaml", "config.yaml"]) {
    const p = join(root, f);
    if (existsSync(p)) want.add(p);
  }

  const out: { path: string; content: string }[] = [];
  for (const p of want) {
    if (out.length >= maxFiles) break;
    try {
      const stat = statSync(p);
      if (stat.size > maxBytes) continue;
      const content = readFileSync(p, "utf-8");
      out.push({ path: p.replace(root + "/", ""), content });
    } catch {
      /* unreadable - skip */
    }
  }
  return out;
}

export function buildSurface(opts: SurfaceOptions): ProductSurface {
  const graph = loadGraph(opts.dataDir);
  const surface: ProductSurface = {
    graph,
    description: opts.description,
  };
  if (opts.dataDir) {
    const shots = join(opts.dataDir, "screenshots");
    if (existsSync(shots)) {
      const screenshots: Record<string, string> = {};
      for (const f of readdirSync(shots).filter((f) => f.endsWith(".png"))) {
        screenshots[f.replace(/\.png$/, "").replace(/_/g, "/")] = join(shots, f);
      }
      if (Object.keys(screenshots).length) surface.screenshots = screenshots;
    }
  }
  if (opts.repoRoot && existsSync(opts.repoRoot)) {
    surface.source = listSourceFiles(opts.repoRoot);
    surface.components = buildComponents(opts.repoRoot);
    surface.fileContents = readKeyFiles(opts.repoRoot, opts.maxFileContents ?? DEFAULT_MAX_FILES, opts.maxFileBytes ?? DEFAULT_MAX_BYTES);
  }
  surface.docs = listDocs(opts.repoRoot, opts.docDirs);
  if (opts.baseUrl) surface.description = surface.description ? `${surface.description}\nBase URL: ${opts.baseUrl}` : `Base URL: ${opts.baseUrl}`;
  return surface;
}

/** List interesting source files under a root (skip heavy dirs). */
function listSourceFiles(root: string, max = 300): string[] {
  const out: string[] = [];
  const skip = new Set(["node_modules", ".git", "dist", "build", ".next", "venv", ".venv", "__pycache__", "coverage", "vendor"]);
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || out.length >= max) return;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(name.name)) continue;
      const p = join(dir, name.name);
      if (name.isDirectory()) walk(p, depth + 1);
      else if (/\.(ts|tsx|js|jsx|py|go|rs|json|yaml|yml|md)$/.test(name.name)) out.push(p);
    }
  };
  walk(root, 0);
  return out.slice(0, max);
}

const DOC_NAMES = ["README.md", "README", "docs", "config.example.yaml", "env.example", ".env.example"];

/** Collect docs: explicit doc dirs + well-known doc files at the repo root. */
function listDocs(repoRoot: string | undefined, docDirs: string[] | undefined): string[] {
  const out: string[] = [];
  for (const d of docDirs ?? []) {
    if (existsSync(d)) {
      const stat = statSync(d);
      if (stat.isDirectory()) for (const f of readdirSync(d)) if (/\.(md|yaml|yml)$/.test(f)) out.push(join(d, f));
      else out.push(d);
    }
  }
  if (repoRoot) for (const n of DOC_NAMES) {
    const p = join(repoRoot, n);
    if (existsSync(p)) out.push(p);
  }
  return [...new Set(out)];
}

/** Minimal component inventory from a repo root (top-level dirs + key manifests). */
function buildComponents(repoRoot: string | undefined): ComponentInfo[] {
  if (!repoRoot || !existsSync(repoRoot)) return [];
  const components: ComponentInfo[] = [];
  for (const dirent of readdirSync(repoRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory() || /node_modules|\.git|\.next|venv/.test(dirent.name)) continue;
    components.push({ name: dirent.name, path: dirent.name });
  }
  for (const m of ["package.json", "requirements.txt", "docker-compose.yml"]) {
    const p = join(repoRoot, m);
    if (existsSync(p)) components.push({ name: m, path: m, role: "manifest" });
  }
  return components;
}

/** Load a discovered graph from a data dir (graph.json or versions/*). */
function loadGraph(dataDir: string | undefined): unknown {
  if (!dataDir || !existsSync(dataDir)) return undefined;
  const graphPath = join(dataDir, "graph.json");
  if (existsSync(graphPath)) {
    try {
      return JSON.parse(readFileSync(graphPath, "utf-8"));
    } catch {
      /* ignore */
    }
  }
  const versionsDir = join(dataDir, "versions");
  if (existsSync(versionsDir)) {
    const f = readdirSync(versionsDir).find((n) => n.startsWith("intended-"));
    if (f) {
      try {
        return JSON.parse(readFileSync(join(versionsDir, f), "utf-8"));
      } catch {
        /* ignore */
      }
    }
  }
  return undefined;
}

