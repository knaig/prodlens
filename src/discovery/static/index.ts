// Orchestrates the static pre-pass: route inventory + AST scan -> a partial
// Graph the live crawler can start from and cross-reference against.
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { discoverNextAppRouterRoutes, type StaticRoute } from "./route-inventory.js";
import { createProject, scanFile, type StaticInteraction } from "./ast-scan.js";
import { matchPathToPattern } from "../../graph/route-match.js";
import type { Edge, Graph, Node } from "../../types.js";

export interface StaticPassOptions {
  /** Root of the Next.js app directory, e.g. "<repo>/src/app". */
  appDir: string;
  /** Root to scan for interactions - usually "<repo>/src" (app + components). */
  srcRoot: string;
  tsConfigFilePath?: string;
}

export interface StaticPassResult {
  routes: StaticRoute[];
  interactions: (StaticInteraction & { fromRoute: string })[];
  graph: Graph;
}

export function runStaticPass(opts: StaticPassOptions): StaticPassResult {
  const routes = discoverNextAppRouterRoutes(opts.appDir);
  const pageRoutesByDir = new Map<string, StaticRoute>();
  for (const r of routes) if (r.kind === "page") pageRoutesByDir.set(dirname(r.file), r);

  const project = createProject(opts.tsConfigFilePath);
  const files = listSourceFiles(opts.srcRoot);
  const interactions: (StaticInteraction & { fromRoute: string })[] = [];

  for (const file of files) {
    const sourceFile = project.addSourceFileAtPath(file);
    const found = scanFile(sourceFile);
    const fromRoute = resolveFromRoute(file, opts.appDir, pageRoutesByDir);
    for (const f of found) interactions.push({ ...f, fromRoute });
  }

  const graph = buildGraph(routes, interactions);
  return { routes, interactions, graph };
}

function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(tsx|ts)$/.test(entry) && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
        out.push(full);
      }
    }
  }
  walk(root);
  return out;
}

/** Best-effort: a file colocated with (or nested under) a page.tsx belongs to
 *  that route. A file with no page.tsx ancestor (e.g. src/components/) is
 *  treated as shared/global - it can appear on more than one screen, and the
 *  live crawler is what actually attributes its behavior per page. */
function resolveFromRoute(file: string, appDir: string, pageRoutesByDir: Map<string, StaticRoute>): string {
  let dir = dirname(file);
  if (!dir.startsWith(appDir)) return "*";
  while (dir.startsWith(appDir)) {
    const route = pageRoutesByDir.get(dir);
    if (route) return route.pattern;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "*";
}

/** Reduces a target string (raw source text of an href/router.push argument)
 *  to a comparable pattern: strip quotes/backticks, collapse any
 *  `${...}` interpolation to `*`. */
function normalizeTarget(target: string): string {
  return target
    .replace(/^[`'"]|[`'"]$/g, "")
    .replace(/\$\{[^}]*\}/g, "*")
    .replace(/\/+$/, "") || "/";
}

function resolveTargetToRoute(target: string, routes: StaticRoute[]): string | null {
  const normalizedTarget = normalizeTarget(target);
  const targetSegments = normalizedTarget.split("/").filter(Boolean);
  // A target with two interpolations adjacent to each other (no literal
  // separator between them, e.g. `/${a}${b}`) collapses to a single "**"
  // segment - we cannot tell how many real path segments that represents,
  // so refuse to guess rather than risk matching the wrong route.
  if (targetSegments.some((seg) => seg.includes("**"))) return null;

  const pageRoutes = routes.filter((r) => r.kind === "page");
  const patterns = pageRoutes.map((r) => r.pattern);
  return matchPathToPattern(normalizedTarget, patterns);
}

function buildGraph(routes: StaticRoute[], interactions: (StaticInteraction & { fromRoute: string })[]): Graph {
  const nodes: Record<string, Node> = {};
  for (const r of routes) {
    if (r.kind !== "page") continue;
    nodes[r.pattern] = {
      id: r.pattern,
      url: r.pattern,
      stateSignature: r.pattern,
      source: "code",
      sourceFile: relative(process.cwd(), r.file),
    };
  }

  const edges: Edge[] = interactions.map((it, i) => {
    const resolvedTo = it.target ? resolveTargetToRoute(it.target, routes) : null;
    return {
      id: `static-${i}`,
      from: it.fromRoute,
      to: it.classification === "navigates" ? resolvedTo : null,
      action: it.label ? `${it.kind === "link" ? "Navigate via" : "Click"} "${it.label}"` : it.kind,
      isReturnPath: false,
      status: it.classification === "dead" ? "broken" : "untested",
      source: "code",
      sourceFile: relative(process.cwd(), it.file),
      sourceLine: it.line,
      staticClassification: it.classification,
      error: it.classification === "dead" ? "No onClick, href, or form action - element does nothing" : undefined,
    };
  });

  const entryPoints = routes.filter((r) => r.kind === "page" && r.pattern === "/").map((r) => r.pattern);
  return { nodes, edges, entryPoints: entryPoints.length ? entryPoints : Object.keys(nodes).slice(0, 1) };
}
