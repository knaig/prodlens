// Project artifact surfacing for the explorer's Projects tab: turns a run's
// out-dir (graph.json, versions/, reports/, path-results.json, scenarios,
// videos, screenshots) plus any spec/docs directory into a browsable,
// in-tool list so the developer never has to leave prodlens to read
// what it produced. Everything is embedded into the self-contained HTML, so
// this stays consistent with the tool's "no server needed" philosophy.
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, copyFileSync } from "node:fs";
import { join, relative, basename, extname } from "node:path";

export interface Artifact {
  name: string; // filename (videos/screenshots) or relative path (reports/versions)
  group: "reports" | "spec" | "artifacts" | "videos" | "screenshots";
  kind: "markdown" | "json" | "text" | "video" | "image" | "html";
  relPath: string; // path relative to the project root, for display
  absPath: string;
  /** URL to use for <img>/<video> src. file:// absolute locally; the served
   *  relative path (e.g. "assets/x.webm") when webAssetsDir is set. */
  served?: string;
  size: number;
  content?: string; // text content for preview (markdown/json/text)
  videoPoster?: string; // for videos: first matching screenshot, if any
}

export interface ProjectArtifacts {
  root: string;
  items: Artifact[];
}

interface CollectOptions {
  specDirs?: string[];
  assetsDir?: string;
  /** When set, non-text artifacts (video/image) are copied here and their
   *  relPath rewritten relative to it, so the rendered HTML works when
   *  served (e.g. from Vercel), not just from local file:// paths. Text
   *  artifacts are always embedded, so they don't need copying. */
  webAssetsDir?: string;
}

const TEXT_EXT: Record<string, "markdown" | "json" | "text"> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".json": "json",
  ".txt": "text",
};

/** Scans a project out-dir plus optional spec/docs dirs into a flat,
 *  grouped artifact list. Best-effort: skips anything unreadable/oversized. */
export function collectProjectArtifacts(projectRoot: string, opts: CollectOptions = {}): Artifact[] {
  const items: Artifact[] = [];
  const push = (absPath: string, group: Artifact["group"]) => {
    if (!existsSync(absPath)) return;
    const st = statSync(absPath);
    if (!st.isFile()) return;
    const size = st.size;
    if (size > 2 * 1024 * 1024) return; // don't embed megabytes into the HTML
    const ext = extname(absPath).toLowerCase();
    const rel = relative(projectRoot, absPath);
    if (ext === ".md" || ext === ".markdown" || ext === ".json" || ext === ".txt") {
      let content: string | undefined;
      try {
        content = readFileSync(absPath, "utf-8").slice(0, 200000);
      } catch {
        /* unreadable - skip content, still list by name */
      }
      items.push({
        name: basename(absPath),
        group,
        kind: TEXT_EXT[ext] ?? "text",
        relPath: rel,
        absPath,
        size,
        content,
      });
    } else if (ext === ".webm" || ext === ".mp4" || ext === ".mov") {
      items.push({ name: basename(absPath), group, kind: "video", relPath: rel, absPath, size });
    } else if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif") {
      items.push({ name: basename(absPath), group, kind: "image", relPath: rel, absPath, size });
    } else if (ext === ".html") {
      items.push({ name: basename(absPath), group, kind: "html", relPath: rel, absPath, size });
    }
  };

  const walk = (dir: string, group: Artifact["group"]) => {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const p = join(dir, entry);
      const st = statSync(p);
      if (st.isDirectory()) {
        // report .md and graph .json live at the top level; skip nested temp dirs
        walk(p, group);
      } else {
        push(p, group);
      }
    }
  };

  // Reports + generated artifacts live at the project root.
  for (const file of readdirSync(projectRoot)) {
    const p = join(projectRoot, file);
    if (statSync(p).isFile()) push(p, "artifacts");
  }
  // Known subdirs map to groups.
  const groupDirs: Record<string, Artifact["group"]> = {
    "reports": "reports",
    "versions": "artifacts",
    "screenshots": "screenshots",
    "videos": "videos",
    "gepa": "artifacts",
  };
  for (const [dir, group] of Object.entries(groupDirs)) {
    walk(join(projectRoot, dir), group);
  }

  // Optional spec/docs assets live outside the run out-dir.
  for (const dir of opts.specDirs ?? []) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      const p = join(dir, file);
      if (statSync(p).isFile()) push(p, "spec");
    }
  }
  // Optional other asset dir (screenshots from `run`, etc.).
  if (opts.assetsDir) walk(opts.assetsDir, "screenshots");

  // Web mode: copy non-text assets under webAssetsDir and point the rendered
  // HTML at their served (relative) paths instead of absolute file:// paths.
  if (opts.webAssetsDir) {
    mkdirSync(opts.webAssetsDir, { recursive: true });
    for (const it of items) {
      if (it.kind !== "video" && it.kind !== "image" && it.kind !== "html") continue;
      if (it.kind === "html" && it.relPath === "explorer.html") continue; // self - don't copy
      const destName = `${it.group}-${basename(it.absPath).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const dest = join(opts.webAssetsDir, destName);
      try {
        copyFileSync(it.absPath, dest);
        it.relPath = `assets/${destName}`;
        it.absPath = dest;
        it.served = `assets/${destName}`;
      } catch {
        /* copy failed - leave file:// path, image/video just won't load when served */
      }
    }
  }

  // Give videos a poster: same-named screenshot if one exists.
  const shotsByBase = new Map<string, string>();
  for (const it of items) if (it.kind === "image") shotsByBase.set(basename(it.absPath), it.relPath);
  for (const it of items) {
    if (it.kind !== "video") continue;
    const stem = basename(it.absPath).replace(/\.[^.]+$/, "");
    it.videoPoster = shotsByBase.get(`${stem}.png`) ?? shotsByBase.get(`${stem}.jpg`);
  }

  items.sort((a, b) => a.group.localeCompare(b.group) || a.relPath.localeCompare(b.relPath));
  return items;
}

/** Renders the Projects tab body HTML given collected artifacts. */
export function renderProjectsHtml(project: Artifact[]): string {
  if (!project.length) return '<p class="muted">No project artifacts to show.</p>';

  const byGroup = new Map<Artifact["group"], Artifact[]>();
  for (const a of project) {
    const list = byGroup.get(a.group) ?? [];
    list.push(a);
    byGroup.set(a.group, list);
  }
  const groupLabel: Record<Artifact["group"], string> = {
    reports: "Reports",
    spec: "Specs & docs",
    artifacts: "Generated artifacts",
    videos: "Journey videos",
    screenshots: "Screenshots",
  };

  const sections: string[] = [];
  for (const [g, items] of byGroup) {
    sections.push(
      "<h2>" + groupLabel[g] + " (" + items.length + ")</h2>" +
        "<table><tr><th>File</th><th></th></tr>" +
        items
          .map((a) => {
            const open = '<button class="artifact-open" data-id="' + escapeHtml(a.relPath) + '">open</button>';
            return "<tr><td><code>" + escapeHtml(a.relPath) + "</code> &middot; " + bytes(a.size) + "</td><td>" + open + "</td></tr>";
          })
          .join("")
    );
  }
  const listHtml = sections.join("");

const detail = project
    .map((a) => {
      const head = '<div id="' + escapeHtml(a.relPath) + '" class="artifact-detail" hidden><h3>' + escapeHtml(a.relPath) + "</h3>";
      if (a.kind === "markdown") return head + '<div class="markdown">' + renderMarkdown(a.content ?? "") + "</div></div>";
      if (a.kind === "json") return head + "<pre>" + escapeHtml(prettifyJson(a.content ?? "")) + "</pre></div>";
      if (a.kind === "text") return head + "<pre>" + escapeHtml(a.content ?? "") + "</pre></div>";
      if (a.kind === "html") return head + '<p class="muted">HTML artifact - no inline preview.</p></div>';
      if (a.kind === "video") {
        const poster = a.videoPoster ? ' poster="' + escapeHtml(a.videoPoster) + '"' : "";
        const src = a.served ?? "file://" + a.absPath;
        return head + '<video controls preload="metadata"' + poster + "><source src=\"" + escapeHtml(src) + "\" /></video></div>";
      }
      if (a.kind === "image") {
        const src = a.served ?? "file://" + a.absPath;
        return head + '<img src="' + escapeHtml(src) + '" style="max-width:100%" /></div>';
      }
      return "";
    })
    .join("");

  return '<div class=projects-layout><div class=projects-list>' + listHtml + "</div><div class=projects-detail>" + detail + "</div></div>";
}

function bytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(s ?? "").replace(/[&<>"']/g, (c) => map[c] ?? c);
}

function prettifyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

/** Tiny markdown renderer - headings, code, links, lists. Good enough for
 *  our reports/specs; not a full md implementation. */
function renderMarkdown(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) {
        const lvl = h[1].length + 1;
        return "<h" + lvl + ">" + inline(h[2]) + "</h" + lvl + ">";
      }
      if (/^[-*]\s+/.test(line)) return "<li>" + inline(line.replace(/^[-*]\s+/, "")) + "</li>";
      if (/^\|/.test(line)) return line;
      if (/^```/.test(line)) return '<pre class="codeblock">' + escapeHtml(line.replace(/^```.*/, "") );
      return "<p>" + inline(line) + "</p>";
    })
    .join("");
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<a href=\"$2\">$1</a>");
}