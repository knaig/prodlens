// Framework-aware route discovery. Next.js App Router today; the shape is
// deliberately narrow (just a list of route patterns + the file that defines
// them) so a React Router / other-framework adapter can be added later
// without touching the rest of the static pass.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface StaticRoute {
  pattern: string; // e.g. "/[project]/studio/[id]"
  file: string; // absolute path to the page/route file
  kind: "page" | "route";
}

const PAGE_FILES = new Set(["page.tsx", "page.ts", "page.jsx", "page.js"]);
const ROUTE_FILES = new Set(["route.ts", "route.js"]);
const SKIP_FILES = new Set(["layout.tsx", "layout.ts", "loading.tsx", "error.tsx", "not-found.tsx", "template.tsx"]);

/** True for Next.js route groups: "(app)" contributes no URL segment. */
function isRouteGroup(segment: string): boolean {
  return segment.startsWith("(") && segment.endsWith(")");
}

export function discoverNextAppRouterRoutes(appDir: string): StaticRoute[] {
  const routes: StaticRoute[] = [];

  function walk(dir: string, segments: string[]) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (entry === "api") {
          walk(full, [...segments, entry]);
          continue;
        }
        const nextSegments = isRouteGroup(entry) ? segments : [...segments, entry];
        walk(full, nextSegments);
        continue;
      }
      if (PAGE_FILES.has(entry)) {
        routes.push({ pattern: toPattern(segments), file: full, kind: "page" });
      } else if (ROUTE_FILES.has(entry)) {
        routes.push({ pattern: toPattern(segments), file: full, kind: "route" });
      } else if (!SKIP_FILES.has(entry)) {
        // component/action/other file colocated with a route - not a route itself
      }
    }
  }

  walk(appDir, []);
  return routes;
}

function toPattern(segments: string[]): string {
  if (segments.length === 0) return "/";
  return "/" + segments.join("/");
}
